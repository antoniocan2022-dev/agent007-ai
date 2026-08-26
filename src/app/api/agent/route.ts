import { NextRequest } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { runOrchestrator, type OrchestratorEventEmit } from '@/lib/orchestrator'
import { beginInteractive, endInteractive } from '@/lib/load-tracker'
import { runCeoCognitiveLifecycle } from '@/lib/ceo-cognitive-lifecycle'
import { preRouteCeoRequest, resolvePreRoute } from '@/lib/ceo-pre-router'
import { getCanonicalOrganizationPrompt } from '@/lib/canonical-organization-prompt'
import { AgentRequestTimeoutError, AGENT_REQUEST_BUDGET_MS, runWithAgentRequestBudget } from '@/lib/agent-request-budget'
import type { AttachmentMeta } from '@/lib/tools'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Keep a safety margin below Vercel's 300s hard ceiling so a request can
// close cleanly before the platform kills the function.
export const maxDuration = 240

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
  const preRoute = preRouteCeoRequest([{ role: 'user', content: message }], atts.length)
  const resolvedPath = resolvePreRoute(preRoute)

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
        try { controller.enqueue(encoder.encode(s)) } catch { closed = true }
      }
      const emit: OrchestratorEventEmit = async (event: string, data: any) => safeEnqueue(sse(event, data))
      const heartbeat = setInterval(() => safeEnqueue(sse('ping', { ts: Date.now() })), 5000)

      beginInteractive()
      try {
        if (resolvedPath === 'fast') {
          safeEnqueue(sse('progress', {
            phase: 'fast_lane',
            route: preRoute.route,
            reason: preRoute.reason,
            taskClass: preRoute.taskClass,
          }))

          const response = await runCeoCognitiveLifecycle({
            attachmentsCount: atts.length,
            messages: [
              {
                role: 'system',
                content: `You are Agent007, the CEO and executive intelligence of a governed AI organization. Answer the user directly, naturally, accurately, and without claiming unperformed actions or verification.\n\n${getCanonicalOrganizationPrompt()}`,
              },
              { role: 'user', content: message },
            ],
            taskType: preRoute.taskClass,
            verification: 'standard',
            timeoutMs: 15000,
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
            executionClass: response.decisionPlan.path,
            evidenceState: response.evidenceState,
            quality: response.quality,
            responseMs: response.responseMs,
          }))
          safeEnqueue(sse('done', {
            messageId: persistedAssistantMessageId,
            steps: 1,
            executionClass: response.decisionPlan.path,
            provider: response.provider,
            model: response.model,
            evidenceState: response.evidenceState,
          }))
        } else {
          // The orchestrator is the tool-runtime lane. Its LLM compatibility
          // import resolves through the canonical bridge, so every model call
          // still enters the bounded cognitive lifecycle with the canonical org context.
          // The request budget prevents a long-running orchestration from ever
          // reaching Vercel's hard timeout. The signal is passed through now so
          // cooperative cancellation can be adopted by deeper runtime layers.
          const result = await runWithAgentRequestBudget(
            (signal) => runOrchestrator({
              conversationId,
              userMessage: message,
              attachments: atts,
              language: lang,
              emit,
              signal,
            } as OrchestratorRunOptionsWithSignal),
            AGENT_REQUEST_BUDGET_MS,
          )
          safeEnqueue(sse('done', {
            messageId: result.persistedAssistantMessageId,
            steps: result.steps.length,
            executionClass: preRoute.adaptiveExecutionClass ?? 'standard',
          }))
        }
      } catch (e: any) {
        if (e instanceof AgentRequestTimeoutError || e?.code === 'AGENT_REQUEST_TIMEOUT') {
          await emit('error', {
            message: 'Agent007 stopped this request before the platform timeout so it can remain responsive. The work already persisted is safe; retry to continue from the durable state.',
            executionClass: resolvedPath,
            code: 'AGENT_REQUEST_TIMEOUT',
            timeoutMs: AGENT_REQUEST_BUDGET_MS,
            retryable: true,
          })
        } else {
          safeEnqueue(sse('error', { message: e?.message ?? String(e), executionClass: resolvedPath }))
        }
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

interface OrchestratorRunOptionsWithSignal {
  conversationId: string
  userMessage: string
  attachments: AttachmentMeta[]
  language: 'en' | 'zh'
  emit: OrchestratorEventEmit
  signal: AbortSignal
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
