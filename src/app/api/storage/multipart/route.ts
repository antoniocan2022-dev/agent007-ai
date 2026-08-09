import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { ociStorageConfig, presignOciS3Url } from '@/lib/oci-s3-signer'

export const runtime = 'nodejs'

const MAX_FILE_BYTES = 100 * 1024 * 1024 * 1024
const PART_SIZE_BYTES = 256 * 1024 * 1024
const MAX_PARTS = 10000

function safeObjectName(name: string) {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'upload.bin'
  return `uploads/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${cleaned}`
}

async function readXml(response: Response) {
  const text = await response.text()
  if (!response.ok) throw new Error(`OCI storage request failed (${response.status}): ${text.slice(0, 500)}`)
  return text
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const action = body?.action
    const { bucket } = ociStorageConfig()

    if (action === 'initiate') {
      const size = Number(body.size)
      const name = String(body.name || 'upload.bin')
      const contentType = String(body.contentType || 'application/octet-stream')
      if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: 'File must be between 1 byte and 100 GB.' }, { status: 400 })
      }
      const parts = Math.ceil(size / PART_SIZE_BYTES)
      if (parts > MAX_PARTS) return NextResponse.json({ error: 'File would require too many multipart parts.' }, { status: 400 })

      const key = safeObjectName(name)
      const url = presignOciS3Url({ method: 'POST', key, query: { uploads: '' }, expiresIn: 900 })
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': contentType },
        cache: 'no-store',
      })
      const xml = await readXml(response)
      const uploadId = xml.match(/<UploadId>([^<]+)<\/UploadId>/)?.[1]
      if (!uploadId) throw new Error('OCI did not return an upload ID')

      return NextResponse.json({
        bucket,
        key,
        uploadId,
        partSize: PART_SIZE_BYTES,
        totalParts: parts,
        maxSize: MAX_FILE_BYTES,
      })
    }

    if (action === 'presign-part') {
      const key = String(body.key || '')
      const uploadId = String(body.uploadId || '')
      const partNumber = Number(body.partNumber)
      if (!key || !uploadId || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_PARTS) {
        return NextResponse.json({ error: 'Invalid multipart part request.' }, { status: 400 })
      }
      const url = presignOciS3Url({
        method: 'PUT',
        key,
        query: { partNumber: String(partNumber), uploadId },
        expiresIn: 3600,
      })
      return NextResponse.json({ url, expiresIn: 3600 })
    }

    if (action === 'complete') {
      const key = String(body.key || '')
      const uploadId = String(body.uploadId || '')
      const parts = Array.isArray(body.parts) ? body.parts : []
      if (!key || !uploadId || parts.length === 0 || parts.length > MAX_PARTS) {
        return NextResponse.json({ error: 'Invalid multipart completion request.' }, { status: 400 })
      }
      const normalized = parts
        .map((p: { partNumber?: number; etag?: string }) => ({ partNumber: Number(p.partNumber), etag: String(p.etag || '').replace(/^"|"$/g, '') }))
        .filter((p: { partNumber: number; etag: string }) => Number.isInteger(p.partNumber) && p.partNumber > 0 && p.etag)
        .sort((a: { partNumber: number }, b: { partNumber: number }) => a.partNumber - b.partNumber)
      if (normalized.length !== parts.length) return NextResponse.json({ error: 'Invalid part list.' }, { status: 400 })

      const xml = `<?xml version="1.0" encoding="UTF-8"?><CompleteMultipartUpload>${normalized.map((p: { partNumber: number; etag: string }) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag}</ETag></Part>`).join('')}</CompleteMultipartUpload>`
      const url = presignOciS3Url({ method: 'POST', key, query: { uploadId }, expiresIn: 900 })
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/xml' }, body: xml, cache: 'no-store' })
      await readXml(response)
      return NextResponse.json({ ok: true, key, bucket })
    }

    if (action === 'abort') {
      const key = String(body.key || '')
      const uploadId = String(body.uploadId || '')
      if (!key || !uploadId) return NextResponse.json({ error: 'Invalid abort request.' }, { status: 400 })
      const url = presignOciS3Url({ method: 'DELETE', key, query: { uploadId }, expiresIn: 900 })
      const response = await fetch(url, { method: 'DELETE', cache: 'no-store' })
      await readXml(response)
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Unknown multipart action.' }, { status: 400 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected storage error'
    console.error('[OCI multipart]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
