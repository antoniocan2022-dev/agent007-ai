import { NextRequest } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { runOrchestrator, type OrchestratorEventEmit } from '@/lib/orchestrator'
import { beginInteractive, endInteractive } from '@/lib/load-tracker'
import type { AttachmentMeta } from '@/lib/tools'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function sse(event: string, data: any): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export async function POST(req: NextRequest) {
  // Ensure DB tables exist before any query (critical for Vercel serverless)
  await ensureDbReady().catch(() => {})

  let body: any
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const { message, conversationId, attachments, language } = body as {
    message?: string
    conversationId?: string
    attachments?: AttachmentMeta[]
    language?: 'en' | 'zh'
  }

  if (!message || typeof message !== 'string') {
    return new Response(JSON.stringify({ error: 'Missing "message"' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (!conversationId || typeof conversationId !== 'string') {
    return new Response(JSON.stringify({ error: 'Missing "conversationId"' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const lang: 'en' | 'zh' = language === 'zh' ? 'zh' : 'en'
  const atts: AttachmentMeta[] = Array.isArray(attachments) ? attachments : []

  // Verify the conversation exists; if not, create it
  let conv = await db.conversation.findUnique({ where: { id: conversationId } })
  if (!conv) {
    conv = await db.conversation.create({ data: { id: conversationId, title: message.slice(0, 50) } })
  }

  // Persist user message
  await db.message.create({
    data: {
      conversationId,
      role: 'user',
      content: message,
      attachments: atts.length ? JSON.stringify(atts.map(stripDataUrl)) : null,
    },
  })

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
      const emit: OrchestratorEventEmit = async (event: string, data: any) => {
        safeEnqueue(sse(event, data))
      }

      // SSE HEARTBEAT — keeps connection alive during long LLM calls
      const heartbeat = setInterval(() => {
        safeEnqueue(sse('ping', { ts: Date.now() }))
      }, 5000)
      // Mark this request as "interactive" so the /api/schedules/tick endpoint
      // defers any scheduled runs until we're done. User-initiated chats always
      // get priority over scheduled autonomous missions.
      beginInteractive()
      try {
        const result = await runOrchestrator({
          conversationId,
          userMessage: message,
          attachments: atts,
          language: lang,
          emit,
        })
        safeEnqueue(sse('done', { messageId: result.persistedAssistantMessageId, steps: result.steps.length }))
      } catch (e: any) {
        safeEnqueue(sse('error', { message: e?.message ?? String(e) }))
      } finally {
        clearInterval(heartbeat)
        endInteractive()
        try {
          controller.close()
        } catch {
          /* ignore */
        }
        closed = true
      }
    },
    cancel() {
      /* client aborted; nothing to do */
    },
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
  // Don't store huge data URLs in DB; keep just metadata + textContent (truncated)
  return {
    filename: a.filename,
    originalName: a.originalName,
    mimeType: a.mimeType,
    size: a.size,
    textContent: a.textContent ? a.textContent.slice(0, 8000) : undefined,
  }
}
