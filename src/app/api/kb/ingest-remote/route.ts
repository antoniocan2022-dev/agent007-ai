import { NextRequest, NextResponse } from 'next/server'
import { getSessionUserId } from '@/lib/session-user'
import { ingestOciDocument } from '@/lib/document-ingestion'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Ingestion streams a potentially large object from OCI, extracts text, and computes embeddings --
// meaningfully longer than a typical API route. Vercel honors this per-route override up to the
// plan's ceiling; on platforms with a hard shorter timeout, requests over that ceiling still fail
// with a clear timeout rather than a fabricated result -- the ownership/size/format errors this
// route returns are the same regardless of how long it ran before hitting one.
export const maxDuration = 300

/**
 * POST /api/kb/ingest-remote
 * Body: { key, filename, mimeType, size, checksum? } -- the same fields oci-large-upload.ts's
 * uploadLargeFile() returns once an OCI large-file upload has completed and been verified.
 *
 * Downloads the object, extracts real text (transcription for audio/video, real per-format parsing
 * for PDF/DOCX/XLSX/PPTX, direct decode for plain text), and indexes it into the same
 * KnowledgeChunk/KnowledgeDoc tables /api/kb (small inline uploads) already uses.
 *
 * Returns { doc: { id, filename, chunkCount, size, extractionMethod, warning? } } on success, or
 * { error } with a clear reason (ownership mismatch, oversize, unsupported format, extraction
 * failure) -- this pipeline fails closed and honest, never fabricates extracted content.
 */
export async function POST(req: NextRequest) {
  const userId = await getSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const key = String(body?.key || '').trim()
  const filename = String(body?.filename || 'upload.bin').trim()
  const mimeType = String(body?.mimeType || 'application/octet-stream').trim()
  const size = Number(body?.size)
  const checksum = body?.checksum && typeof body.checksum === 'object'
    ? { algorithm: String(body.checksum.algorithm || ''), value: String(body.checksum.value || '') }
    : undefined

  if (!key) return NextResponse.json({ error: 'Missing "key"' }, { status: 400 })
  if (!Number.isSafeInteger(size) || size <= 0) return NextResponse.json({ error: 'Missing or invalid "size"' }, { status: 400 })

  const result = await ingestOciDocument({ userId, key, filename, mimeType, size, checksum })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 })

  return NextResponse.json({
    doc: {
      id: result.docId,
      filename: result.filename,
      chunkCount: result.chunkCount,
      size: result.size,
      extractionMethod: result.extractionMethod,
      warning: result.warning,
    },
  })
}
