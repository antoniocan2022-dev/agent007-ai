import { NextRequest } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { runOrchestrator, type OrchestratorEventEmit } from '@/lib/orchestrator'
import { beginInteractive, endInteractive } from '@/lib/load-tracker'
import type { AttachmentMeta } from '@/lib/tools'
import { getAttachmentAsset } from '@/lib/attachment-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

function sse(event: string, data: any): string { return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n` }

type IncomingAttachment = AttachmentMeta & {
  attachmentId?: string
  status?: string
  kind?: string
  downloadOnly?: boolean
}

export async function POST(req: NextRequest) {
  await ensureDbReady().catch(() => {})

  let body: any
  try { body = await req.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }
  const { message, conversationId, attachments, language } = body as {
    message?: string
    conversationId?: string
    attachments?: IncomingAttachment[]
    language?: 'en' | 'zh'
  }

  if (!message || typeof message !== 'string') return new Response(JSON.stringify({ error: 'Missing "message"' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  if (!conversationId || typeof conversationId !== 'string') return new Response(JSON.stringify({ error: 'Missing "conversationId"' }), { status: 400, headers: { 'Content-Type': 'application/json' } })

  const lang: 'en' | 'zh' = language === 'zh' ? 'zh' : 'en'
  const incoming: IncomingAttachment[] = Array.isArray(attachments) ? attachments : []
  const atts: IncomingAttachment[] = []

  try {
    const sessionEmail = (await import('next-auth')).getServerSession
    const session = await sessionEmail()
    const email = session?.user?.email?.trim().toLowerCase()
    if (!email) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
    const owner = await db.user.findUnique({ where: { email } })
    if (!owner) return new Response(JSON.stringify({ error: 'Authenticated user record not found.' }), { status: 401, headers: { 'Content-Type': 'application/json' } })

    for (const item of incoming) {
      if (!item || typeof item !== 'object') continue
      if (item.attachmentId) {
        const asset = await getAttachmentAsset(String(item.attachmentId), owner.id)
        if (!['UPLOADED', 'PROCESSING', 'READY'].includes(asset.status)) throw new Error(`Attachment ${asset.originalName} is not ready for agent use (${asset.status}).`)
        atts.push({
          ...item,
          filename: asset.safeName,
          originalName: asset.originalName,
          mimeType: asset.mimeType,
          size: asset.size,
          attachmentId: asset.id,
          status: asset.status,
          kind: asset.kind,
          downloadOnly: asset.downloadOnly,
        })
      } else {
        // Legacy attachment metadata is retained for compatibility, but the old
        // raw-data URL path is never accepted as proof of storage ownership.
        if (!item.filename || !item.originalName || !Number.isFinite(Number(item.size))) throw new Error('Malformed attachment metadata.')
        atts.push(item)
      }
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Attachment validation failed.' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  let dbReady = true
  try {
    let conv = await db.conversation.findUnique({ where: { id: conversationId } })
    if (!conv) conv = await db.conversation.create({ data: { id: conversationId, title: message.slice(0, 50) } })
    await db.message.create({ data: { conversationId, role: 'user', content: message, attachments: atts.length ? JSON.stringify(atts.map(stripDataUrl)) : null } })
  } catch (dbErr: any) {
    console.warn('[api/agent] Pre-stream DB call failed, continuing without persistence:', dbErr?.message?.slice(0, 150))
    dbReady = false
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
        const result = await runOrchestrator({ conversationId, userMessage: message, attachments: atts as AttachmentMeta[], language: lang, emit })
        safeEnqueue(sse('done', { messageId: result.persistedAssistantMessageId, steps: result.steps.length, dbReady }))
      } catch (e: any) {
        safeEnqueue(sse('error', { message: e?.message ?? String(e) }))
      } finally {
        clearInterval(heartbeat)
        endInteractive()
        try { controller.close() } catch { /* ignore */ }
        closed = true
      }
    },
    cancel() { /* client aborted */ },
  })

  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } })
}

function stripDataUrl(a: IncomingAttachment) {
  return {
    attachmentId: a.attachmentId,
    filename: a.filename,
    originalName: a.originalName,
    mimeType: a.mimeType,
    size: a.size,
    status: a.status,
    kind: a.kind,
    downloadOnly: a.downloadOnly,
    textContent: a.textContent ? a.textContent.slice(0, 8000) : undefined,
  }
}
