import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'node:fs'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const UPLOAD_DIR = '/home/z/my-project/download/uploads'

export async function POST(req: NextRequest) {
  let formData: FormData
  try { formData = await req.formData() } catch { return NextResponse.json({ error: 'Invalid form data' }, { status: 400 }) }
  const file = formData.get('file')
  if (!file || !(file instanceof File)) return NextResponse.json({ error: 'Missing file' }, { status: 400 })
  if (file.size > 30 * 1024 * 1024) return NextResponse.json({ error: 'File too large (max 30MB)' }, { status: 400 })
  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(new Uint8Array(arrayBuffer))
  const mimeType = file.type || 'application/octet-stream'
  const filename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  try { await fs.mkdir(UPLOAD_DIR, { recursive: true }) } catch {}
  await fs.writeFile(`${UPLOAD_DIR}/${filename}`, buffer)
  const isImage = mimeType.startsWith('image/')
  let dataUrl: string | undefined
  if (isImage) dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`
  return NextResponse.json({ ok: true, filename, originalName: file.name, mimeType, size: file.size, dataUrl, path: `${UPLOAD_DIR}/${filename}` })
}
