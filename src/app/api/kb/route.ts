import { NextRequest, NextResponse } from 'next/server'
import path from 'node:path'
import { requestOwnerAuthorization, verifyOwnerAuthorization } from '@/lib/owner-auth'
import { db } from '@/lib/db'
import { getSessionUserId } from '@/lib/session-user'
import { indexDocument } from '@/lib/knowledge-base'
import { extractDocumentText } from '@/lib/document-parsers'
import { transcribeAudioOrVideo, isTranscribableExtension } from '@/lib/media-transcription'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/kb/upload
 * Body: multipart/form-data with field "file" (PDF/DOCX/XLSX/PPTX/TXT/MD/CSV/JSON), max 5MB.
 * For larger files already uploaded via the OCI large-upload path, use POST /api/kb/ingest-remote
 * instead (see document-ingestion.ts).
 *
 * Extracts text from the uploaded document (real per-format parsing for PDF/DOCX/XLSX/PPTX, see
 * document-parsers.ts), chunks it, indexes the chunks and their best-effort embeddings into the
 * KnowledgeChunk table for keyword + semantic search (see knowledge-base.ts).
 *
 * Returns { doc: { id, filename, chunkCount } }
 */
export async function POST(req: NextRequest) {
  const userId = await getSessionUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const formData = await req.formData()
  const file = formData.get('file')
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'Missing "file" in form data' }, { status: 400 })
  }

  // Size cap: 5MB
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'File too large (max 5MB)' }, { status: 400 })
  }

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(new Uint8Array(arrayBuffer))

  // Extract text based on mime type. `warning` is set whenever there is no genuine extracted
  // content to index -- kept separate from `text` so a placeholder message (image/unsupported
  // format/failed transcription/empty parse) never gets chunked and indexed as if it were real
  // document content that a future knowledge-base search could surface as a false hit.
  let text = ''
  let warning: string | undefined
  const mimeType = file.type
  const filename = file.name

  try {
    if (mimeType === 'text/plain' || mimeType === 'text/markdown' || mimeType === 'application/json' || mimeType === 'text/csv' || filename.match(/\.(txt|md|json|csv|js|ts|tsx|jsx|py|go|rs|java|c|cpp|h|sh|sql|yaml|yml|xml|html|css)$/i)) {
      text = buffer.toString('utf-8')
    } else if (mimeType.startsWith('image/')) {
      warning = 'Images are not text-extracted on upload. Use the vision tool to analyze this image.'
    } else if (mimeType.startsWith('audio/') || mimeType.startsWith('video/') || isTranscribableExtension(path.extname(filename))) {
      // Post-merge audit fix (2026-09-12): this branch previously didn't exist, so a small audio/
      // video file fell through to the generic binary fallback below and had its raw bytes decoded
      // as if it were utf-8 text -- garbage that then got chunked and indexed into the knowledge
      // base. media-transcription.ts is already shared, real infrastructure (used by the OCI
      // ingest-remote path and media-tools.ts); reusing it here makes both upload entry points
      // capable of the same thing instead of only one of them actually transcribing audio/video.
      const ext = path.extname(filename).toLowerCase()
      if (!isTranscribableExtension(ext)) {
        warning = `This container format (${ext || mimeType}) is not one this runtime can transcribe (no ffmpeg/transcoding toolchain). Supported: mp3, wav, ogg, flac, m4a, mp4, webm, mpeg, mpga.`
      } else {
        const transcription = await transcribeAudioOrVideo(buffer, filename)
        if (transcription.ok) text = transcription.text
        else warning = `Transcription failed: ${transcription.error}`
      }
    } else {
      // PDF/DOCX/XLSX/PPTX: real per-format extraction (see document-parsers.ts) -- decompresses
      // FlateDecode PDF streams and unzips OOXML parts, rather than the previous raw-byte regex
      // scan that only ever caught uncompressed PDF text and treated DOCX/XLSX/PPTX as plain text.
      const parsed = extractDocumentText(buffer, filename, mimeType)
      if (parsed) {
        text = parsed.text
        warning = parsed.warning ?? (parsed.text ? undefined : 'No text could be extracted.')
      } else {
        // Unrecognized binary format: try utf-8 as a last resort (works for genuinely text-like
        // files with an unexpected mime type; produces mostly-unusable output for real binaries,
        // which the short length/garbled content will make apparent rather than silently pretending
        // otherwise).
        text = buffer.toString('utf-8').slice(0, 50000)
      }
    }
  } catch (e: any) {
    return NextResponse.json({ error: `Text extraction failed: ${e?.message}` }, { status: 500 })
  }

  // Truncate to 500KB to avoid DB bloat
  text = text.slice(0, 500_000)

  // Create the doc record. When there's no real extracted text, store a visible placeholder so the
  // doc is still listed with a clear reason, but never index a placeholder as searchable content.
  const storedText = text || (warning ? `[${filename} uploaded. ${warning}]` : '')
  const doc = await db.knowledgeDoc.create({
    data: {
      userId,
      filename,
      mimeType,
      size: file.size,
      text: storedText,
      chunkCount: 0,
    },
  })

  // Index chunks (only real extracted text, never the placeholder above), then persist the real
  // count -- KnowledgeDoc.chunkCount was previously left at its create-time 0 forever, so every
  // doc in the GET /api/kb list (and the settings-tab UI that renders it) always showed "0 chunks".
  const chunkCount = text ? await indexDocument(userId, doc.id, text) : 0
  if (chunkCount > 0) await db.knowledgeDoc.update({ where: { id: doc.id }, data: { chunkCount } })

  // A document whose extracted text lands exactly on chunkText's 500-chunk hard cap
  // (knowledge-base.ts) very likely had more content truncated rather than happening to end there
  // -- surface that honestly instead of silently indexing only the first ~250K characters.
  if (chunkCount >= 500 && !warning) warning = 'This document is large; only the first ~250,000 characters were indexed for search. The full text is stored, but the remainder is not searchable.'

  return NextResponse.json({
    doc: {
      id: doc.id,
      filename,
      chunkCount,
      size: file.size,
      warning,
    },
  })
}

/**
 * GET /api/kb — list all knowledge docs for the current user.
 */
export async function GET() {
  const userId = await getSessionUserId()
  if (!userId) return NextResponse.json({ docs: [] })

  const docs = await db.knowledgeDoc.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      filename: true,
      mimeType: true,
      size: true,
      chunkCount: true,
      createdAt: true,
    },
  })

  return NextResponse.json({ docs })
}

/**
 * DELETE /api/kb?id=<docId> — delete a doc + all its chunks.
 */
// Owner authorization required for delete operations
async function checkOwnerAuth(operation: string, req: any): Promise<{ ok: boolean; error?: string }> {
  try {
    const authHeader = req.headers.get('x-owner-auth')
    if (authHeader) {
      const { authId, code } = JSON.parse(authHeader)
      const result = verifyOwnerAuthorization(authId, code)
      if (!result.ok) return { ok: false, error: result.message }
      return { ok: true }
    }
  } catch {}
  // No auth provided — request it
  const authResult = await requestOwnerAuthorization(operation)
  return { ok: false, error: 'OWNER_AUTH_REQUIRED:' + JSON.stringify(authResult) }
}

export async function DELETE(req: NextRequest) {
  const userId = await getSessionUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const url = new URL(req.url)
  const docId = url.searchParams.get('id')
  if (!docId) {
    return NextResponse.json({ error: 'Missing "id" param' }, { status: 400 })
  }

  // Verify ownership
  const doc = await db.knowledgeDoc.findFirst({ where: { id: docId, userId } })
  if (!doc) {
    return NextResponse.json({ error: 'Doc not found' }, { status: 404 })
  }

  await db.knowledgeChunk.deleteMany({ where: { docId } })
  await db.knowledgeDoc.delete({ where: { id: docId } })

  return NextResponse.json({ ok: true })
}
