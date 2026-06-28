import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UPLOAD_DIR = '/home/z/my-project/download/uploads'

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'])
const TEXT_EXT = new Set([
  'txt', 'md', 'csv', 'json', 'js', 'ts', 'tsx', 'jsx', 'html', 'css',
  'xml', 'yaml', 'yml', 'log', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'sh', 'sql', 'env',
])

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file uploaded (field name must be "file")' }, { status: 400 })
    }
    const originalName = file.name || 'upload.bin'
    const ext = path.extname(originalName).slice(1).toLowerCase()
    const safeBasename = path.basename(originalName).replace(/[^a-zA-Z0-9._-]/g, '_')
    const id = crypto.randomUUID()
    const savedName = `${id}-${safeBasename}`
    const fullPath = path.join(UPLOAD_DIR, savedName)

    await fs.mkdir(UPLOAD_DIR, { recursive: true })
    const buf = Buffer.from(await file.arrayBuffer())
    await fs.writeFile(fullPath, buf)

    const mimeType = file.type || guessMime(ext)

    // Build metadata; for images include data URL so vision tool can read inline
    let dataUrl: string | undefined
    let textContent: string | undefined
    if (IMAGE_EXT.has(ext)) {
      const mime = ext === 'jpg' ? 'jpeg' : ext
      dataUrl = `data:image/${mime};base64,${buf.toString('base64')}`
    } else if (TEXT_EXT.has(ext) && buf.length < 200_000) {
      try {
        textContent = buf.toString('utf8')
      } catch {
        textContent = undefined
      }
    }

    const meta = {
      filename: savedName,
      originalName,
      mimeType,
      size: buf.length,
      dataUrl,
      textContent,
    }
    return NextResponse.json(meta)
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}

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
    default: return 'application/octet-stream'
  }
}
