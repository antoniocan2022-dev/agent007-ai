import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Vercel-aware upload directory.
// - On Vercel: use /tmp (the only writable directory in serverless).
// - On local dev: use /home/z/my-project/download/uploads for parity with the
//   rest of the project.
const UPLOAD_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), 'agent007-uploads')
  : '/home/z/my-project/download/uploads'
const MAX_BYTES = 16 * 1024 * 1024 // 16 MB

function guessMime(ext: string): string {
  switch (ext) {
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'csv': return 'text/csv'
    case 'json': return 'application/json'
    case 'pdf': return 'application/pdf'
    case 'html': return 'text/html'
    case 'txt':
    case 'md':
    case 'log': return 'text/plain'
    case 'zip': return 'application/zip'
    case 'doc': return 'application/msword'
    case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'xls': return 'application/vnd.ms-excel'
    case 'xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    case 'ppt': return 'application/vnd.ms-powerpoint'
    case 'pptx': return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    case 'mp3': return 'audio/mpeg'
    case 'wav': return 'audio/wav'
    case 'mp4': return 'video/mp4'
    case 'webm': return 'video/webm'
    default: return 'application/octet-stream'
  }
}

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name')
  if (!name) return NextResponse.json({ error: 'Missing ?name=' }, { status: 400 })
  const safe = path.basename(name)
  const full = path.join(UPLOAD_DIR, safe)
  try {
    const buf = await fs.readFile(full)
    const ext = path.extname(safe).slice(1).toLowerCase()
    const mime = guessMime(ext)
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(buf.length),
        'Content-Disposition': `inline; filename="${safe}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }
}

/**
 * POST /api/file
 * Accepts multipart/form-data with a single "file" field (any type).
 * Saves to /home/z/my-project/download/uploads/<filename>
 * Returns { ok, filename, size, mimeType, downloadUrl, attachmentMeta }
 *
 * Supported types (verified at runtime):
 *   - Documents: .txt, .md, .pdf, .doc, .docx, .csv, .html, .json
 *   - Spreadsheets: .xls, .xlsx
 *   - Presentations: .ppt, .pptx
 *   - Images: .png, .jpg, .jpeg, .gif, .webp
 *   - Audio: .mp3, .wav
 *   - Video: .mp4, .webm
 *   - Archives: .zip, .json (for backups), .tar, .gz
 *
 * For ZIP/JSON backup files, the agent can subsequently use:
 *   - <tool name="file_read">{"filename":"..."}</tool> for inline text
 *   - <manage action="load_backup" filename="..."/> for restore-from-backup
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: 'Missing "file" field in multipart form data.' },
        { status: 400 }
      )
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { ok: false, error: `File too large (${file.size} bytes). Max: ${MAX_BYTES} bytes (16 MB).` },
        { status: 413 }
      )
    }

    // Ensure upload dir exists
    await fs.mkdir(UPLOAD_DIR, { recursive: true })

    // Sanitize filename — strip path separators, allow only safe chars
    const originalName = file.name || 'upload.bin'
    const safeName = originalName
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_{2,}/g, '_')
      .slice(0, 200)
    const finalName = `${Date.now()}-${safeName}`
    const finalPath = path.join(UPLOAD_DIR, finalName)

    const bytes = new Uint8Array(await file.arrayBuffer())
    await fs.writeFile(finalPath, bytes)

    const ext = path.extname(finalName).slice(1).toLowerCase()
    const mime = guessMime(ext) || file.type || 'application/octet-stream'

    // Build AttachmentMeta compatible with the agent's tool context
    const isImage = mime.startsWith('image/')
    const isText = mime.startsWith('text/') || ext === 'json' || ext === 'md' || ext === 'csv'
    const isZip = ext === 'zip' || ext === 'tar' || ext === 'gz'
    const isAudio = mime.startsWith('audio/')
    const isVideo = mime.startsWith('video/')

    let textContent: string | undefined
    if (isText && bytes.length < 200_000) {
      try { textContent = new TextDecoder().decode(bytes).slice(0, 20000) } catch {}
    }

    const attachmentMeta = {
      filename: finalName,
      originalName,
      mimeType: mime,
      size: bytes.length,
      textContent,
      dataUrl: isImage ? `data:${mime};base64,${Buffer.from(bytes).toString('base64')}` : undefined,
    }

    return NextResponse.json({
      ok: true,
      filename: finalName,
      originalName,
      size: bytes.length,
      mimeType: mime,
      downloadUrl: `/api/file?name=${encodeURIComponent(finalName)}`,
      attachmentMeta,
      kind: isImage ? 'image' : isText ? 'text' : isZip ? 'archive' : isAudio ? 'audio' : isVideo ? 'video' : 'binary',
      hint: isZip
        ? 'ZIP archive uploaded. Use <manage action="load_backup" filename="..."/> to restore from backup, or use the file_read tool to inspect.'
        : isText
        ? 'Text file uploaded. The agent can read this via <tool name="file_read">{"filename":"..."}</tool>.'
        : isImage
        ? 'Image uploaded. The agent can analyze it via <tool name="vision">{"prompt":"describe","image_index":0}</tool>.'
        : 'File uploaded. Use the appropriate tool to read it (file_read for text, vision for images).',
    })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: `Upload failed: ${e?.message ?? String(e)}` },
      { status: 500 }
    )
  }
}
