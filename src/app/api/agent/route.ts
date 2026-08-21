import { NextRequest } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { runOrchestrator, type OrchestratorEventEmit } from '@/lib/orchestrator'
import { beginInteractive, endInteractive } from '@/lib/load-tracker'
import { runCanonicalLlm } from '@/lib/canonical-llm-router'
import { classifyExecution, shouldUseFastLane } from '@/lib/adaptive-execution'
import type { AttachmentMeta } from '@/lib/tools'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// UPGRADE #161: Increased to 300s — owner confirmed Vercel Pro is active.
export const maxDuration = 300

const FAST_LANE_SYSTEM_PROMPT = `You are Agent007, the CEO and executive intelligence of a governed AI organization.
Answer the user's simple request directly, naturally, and accurately.
Do not claim to have executed tools, changed data, contacted anyone, or verified facts unless those operations actually occurred.
Use the shortest useful answer while preserving professional judgment and truthfulness.`

function sse(event: string, data: any): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export async function POST(req: NextRequest) {
  await ensureDbReady().catch(() => {})

  let body: any
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const { message, conversationId, attachments, language } = body as {
    message?: string
    conversationId?: string
    attachments?: AttachmentMeta[]
    language?: 'en' | 'zh'
  }

  if (!message || typeof message !== 'string') {
    return new Response(JSON.stringify({ error: 'Missing "message"' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }
  if (!conversationId || typeof conversationId !== 'string') {
    return new Response(JSON.stringify({ error: 'Missing "conversationId"' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const lang: 'en' | 'zh' = language === 'zh' ? 'zh' : 'en'
  const atts: AttachmentMeta[] = Array.isArray(attachments) ? attachments : []
  const adaptivePlan = classifyExecution([{ role: 'user', content: message }])
  const useFastLane = shouldUseFastLane(adaptivePlan, atts.length)

  try {
    let conv = await db.conversation.findUnique({ where: { id: conversationId } })
    if (!conv) conv = await db.conversation.create({ data: { id: conversationId, title: message.slice(0, 50) } })
    await db.message.create({
      data: {
        conversationId,
        role: 'user',
        content: message,
        attachments: atts.length ? JSON.stringify(atts.map(stripDataUrl)) : null,
      },
    })
  } catch (dbErr: any) {
    console.warn('[api/agent] Pre-stream DB persistence failed:', dbErr?.message?.slice(0, 150))
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const safeEnqueue = (s: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(s))
        } catch {
          closed = true
        }
      }
      const emit: OrchestratorEventEmit = async (event: string, data: any) => safeEnqueue(sse(event, data))
      const heartbeat = setInterval(() => safeEnqueue(sse('ping', { ts: Date.now() })), 5000)

      beginInteractive()
      try {
        if (useFastLane) {
          safeEnqueue(sse('progress', {
            phase: 'fast_lane',
            executionClass: adaptivePlan.executionClass,
            reason: adaptivePlan.reason,
          }))

          const response = await runCanonicalLlm({
            messages: [
              { role: 'system', content: FAST_LANE_SYSTEM_PROMPT },
              { role: 'user', content: message },
            ],
            taskType: 'reasoning',
            verification: 'standard',
            thinking: false,
            maxTokens: adaptivePlan.maxTokens,
            timeoutMs: adaptivePlan.timeoutMs,
            maxProviderAttempts: adaptivePlan.maxProviderAttempts,
            executionClass: adaptivePlan.executionClass,
          })

          let persistedAssistantMessageId: string | null = null
          try {
            const assistant = await db.message.create({ data: { conversationId, role: 'assistant', content: response.content } })
            persistedAssistantMessageId = assistant.id
          } catch (persistErr: any) {
            console.warn('[api/agent] Fast-lane assistant persistence failed:', persistErr?.message?.slice(0, 150))
          }

          safeEnqueue(sse('answer', {
            content: response.content,
            provider: response.provider,
            model: response.model,
            executionClass: response.executionClass,
            responseMs: response.responseMs,
          }))
          safeEnqueue(sse('done', {
            messageId: persistedAssistantMessageId,
            steps: 1,
            executionClass: response.executionClass,
            provider: response.provider,
            model: response.model,
          }))
        } else {
          const result = await runOrchestrator({ conversationId, userMessage: message, attachments: atts, language: lang, emit })
          safeEnqueue(sse('done', { messageId: result.persistedAssistantMessageId, steps: result.steps.length, executionClass: adaptivePlan.executionClass }))
        }
      } catch (e: any) {
        safeEnqueue(sse('error', { message: e?.message ?? String(e), executionClass: adaptivePlan.executionClass }))
      } finally {
        clearInterval(heartbeat)
        endInteractive()
        try { controller.close() } catch { /* ignore */ }
        closed = true
      }
    },
    cancel() { /* client aborted; nothing to do */ },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

function stripDataUrl(a: AttachmentMeta) {
  return {
    filename: a.filename,
    originalName: a.originalName,
    mimeType: a.mimeType,
    size: a.size,
    textContent: a.textContent ? a.textContent.slice(0, 8000) : undefined,
  }
}
