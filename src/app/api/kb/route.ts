import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUserId } from '@/lib/session-user'
import { indexDocument } from '@/lib/knowledge-base'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/kb/upload
 * Body: multipart/form-data with field "file" (PDF/TXT/MD/CSV/JSON)
 *
 * Extracts text from the uploaded document, chunks it, indexes the chunks
 * into the KnowledgeChunk table for keyword search.
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
    } else if (mimeType === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')) {
      // PDF text extraction requires a library like pdf-parse.
      // For now, attempt to read as text (works for some PDFs) and note limitation.
      try {
        // Try to extract readable text from PDF buffer (very basic — looks for text between BT/ET markers)
        const raw = buffer.toString('latin1')
        const matches = raw.match(/\(([^)]+)\)/g) || []
        text = matches.map((m) => m.slice(1, -1)).join(' ').slice(0, 50000)
        if (text.length < 100) {
          text = `[PDF uploaded: ${filename}. Note: Install pdf-parse for proper PDF text extraction. The file was stored but text extraction is limited.]`
        }
      } catch {
        text = `[PDF uploaded: ${filename}. Text extraction failed — file stored only.]`
      }
    } else if (mimeType.startsWith('image/')) {
      text = `[Image uploaded: ${filename}. Use the vision tool to analyze this image.]`
    } else {
      // Try utf-8 as fallback
      text = buffer.toString('utf-8').slice(0, 50000)
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
