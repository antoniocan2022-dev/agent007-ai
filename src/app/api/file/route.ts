import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UPLOAD_DIR = '/home/z/my-project/download/uploads'

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
