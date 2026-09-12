import { NextRequest, NextResponse } from 'next/server'
import { requestOwnerAuthorization, verifyOwnerAuthorization } from '@/lib/owner-auth'
import { db } from '@/lib/db'
import { getSessionUserId } from '@/lib/session-user'
import { indexDocument } from '@/lib/knowledge-base'
import { extractDocumentText } from '@/lib/document-parsers'

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

  // Extract text based on mime type
  let text = ''
  const mimeType = file.type
  const filename = file.name

  try {
    if (mimeType === 'text/plain' || mimeType === 'text/markdown' || mimeType === 'application/json' || mimeType === 'text/csv' || filename.match(/\.(txt|md|json|csv|js|ts|tsx|jsx|py|go|rs|java|c|cpp|h|sh|sql|yaml|yml|xml|html|css)$/i)) {
      text = buffer.toString('utf-8')
    } else if (mimeType.startsWith('image/')) {
      text = `[Image uploaded: ${filename}. Use the vision tool to analyze this image.]`
    } else {
      // PDF/DOCX/XLSX/PPTX: real per-format extraction (see document-parsers.ts) -- decompresses
      // FlateDecode PDF streams and unzips OOXML parts, rather than the previous raw-byte regex
      // scan that only ever caught uncompressed PDF text and treated DOCX/XLSX/PPTX as plain text.
      const parsed = extractDocumentText(buffer, filename, mimeType)
      if (parsed) {
        text = parsed.text || `[${filename} uploaded. ${parsed.warning ?? 'No text could be extracted.'}]`
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

  // Create the doc record
  const doc = await db.knowledgeDoc.create({
    data: {
      userId,
      filename,
      mimeType,
      size: file.size,
      text,
      chunkCount: 0,
    },
  })

  // Index chunks
  const chunkCount = await indexDocument(userId, doc.id, text)

  return NextResponse.json({
    doc: {
      id: doc.id,
      filename,
      chunkCount,
      size: file.size,
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
