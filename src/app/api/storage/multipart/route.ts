import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { randomUUID } from 'node:crypto'
import { authOptions } from '@/lib/auth'
import { ociStorageConfig, presignOciS3Url } from '@/lib/oci-s3-signer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_FILE_BYTES = 100 * 1024 * 1024 * 1024
const PART_SIZE_BYTES = 256 * 1024 * 1024
const MAX_PARTS = 10000
const CHECKSUM_ALGORITHM = 'SHA256'

function safeObjectName(name: string) {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'upload.bin'
  return `uploads/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${cleaned}`
}

function isOwnedUploadKey(key: string) {
  return /^uploads\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}-[a-zA-Z0-9._-]+$/.test(key)
}

async function requireSession() {
  const session = await getServerSession(authOptions)
  return session?.user?.email ? session : null
}

async function readResponse(response: Response) {
  const text = await response.text()
  if (!response.ok) throw new Error(`OCI storage request failed (${response.status}): ${text.slice(0, 500)}`)
  return text
}

export async function POST(request: NextRequest) {
  const session = await requireSession()
  if (!session) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })

  try {
    const body = await request.json()
    const action = body?.action
    const { bucket } = ociStorageConfig()

    if (action === 'initiate') {
      const size = Number(body.size)
      const name = String(body.name || 'upload.bin')
      const contentType = String(body.contentType || 'application/octet-stream').slice(0, 255)
      if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: 'File must be between 1 byte and 100 GB.' }, { status: 400 })
      }
      const parts = Math.ceil(size / PART_SIZE_BYTES)
      if (parts > MAX_PARTS) return NextResponse.json({ error: 'File would require too many multipart parts.' }, { status: 400 })

      const key = safeObjectName(name)
      const url = presignOciS3Url({
        method: 'POST',
        key,
        query: { uploads: '' },
        headers: { 'opc-checksum-algorithm': CHECKSUM_ALGORITHM },
        expiresIn: 900,
      })
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': contentType,
          'opc-checksum-algorithm': CHECKSUM_ALGORITHM,
        },
        cache: 'no-store',
      })
      const xml = await readResponse(response)
      const uploadId = xml.match(/<UploadId>([^<]+)<\/UploadId>/)?.[1]
      if (!uploadId) throw new Error('OCI did not return an upload ID')

      return NextResponse.json({
        bucket,
        key,
        uploadId,
        partSize: PART_SIZE_BYTES,
        totalParts: parts,
        maxSize: MAX_FILE_BYTES,
        checksumAlgorithm: CHECKSUM_ALGORITHM,
      })
    }

    if (action === 'presign-part') {
      const key = String(body.key || '')
      const uploadId = String(body.uploadId || '')
      const partNumber = Number(body.partNumber)
      if (!isOwnedUploadKey(key) || !uploadId || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_PARTS) {
        return NextResponse.json({ error: 'Invalid multipart part request.' }, { status: 400 })
      }
      const url = presignOciS3Url({
        method: 'PUT',
        key,
        query: { partNumber: String(partNumber), uploadId },
        headers: { 'opc-checksum-algorithm': CHECKSUM_ALGORITHM },
        expiresIn: 3600,
      })
      return NextResponse.json({ url, expiresIn: 3600, checksumAlgorithm: CHECKSUM_ALGORITHM })
    }

    if (action === 'complete') {
      const key = String(body.key || '')
      const uploadId = String(body.uploadId || '')
      const expectedParts = Number(body.totalParts)
      const parts = Array.isArray(body.parts) ? body.parts : []
      if (!isOwnedUploadKey(key) || !uploadId || !Number.isInteger(expectedParts) || expectedParts < 1 || expectedParts > MAX_PARTS || parts.length !== expectedParts) {
        return NextResponse.json({ error: 'Invalid multipart completion request.' }, { status: 400 })
      }

      const normalized = parts
        .map((p: { partNumber?: number; etag?: string }) => ({
          partNumber: Number(p.partNumber),
          etag: String(p.etag || '').replace(/^"|"$/g, ''),
        }))
        .sort((a: { partNumber: number }, b: { partNumber: number }) => a.partNumber - b.partNumber)

      for (let i = 0; i < normalized.length; i += 1) {
        const part = normalized[i]
        if (!Number.isInteger(part.partNumber) || part.partNumber !== i + 1 || !/^[^\s"<>]+$/.test(part.etag)) {
          return NextResponse.json({ error: 'Multipart parts must be contiguous, ordered and have valid ETags.' }, { status: 400 })
        }
      }

      const xml = `<?xml version="1.0" encoding="UTF-8"?><CompleteMultipartUpload>${normalized.map((p: { partNumber: number; etag: string }) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag}</ETag></Part>`).join('')}</CompleteMultipartUpload>`
      const url = presignOciS3Url({
        method: 'POST',
        key,
        query: { uploadId },
        headers: { 'opc-checksum-algorithm': CHECKSUM_ALGORITHM },
        expiresIn: 900,
      })
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/xml',
          'opc-checksum-algorithm': CHECKSUM_ALGORITHM,
        },
        body: xml,
        cache: 'no-store',
      })
      await readResponse(response)
      return NextResponse.json({ ok: true, key, bucket, totalParts: expectedParts })
    }

    if (action === 'verify') {
      const key = String(body.key || '')
      const expectedSize = Number(body.size)
      if (!isOwnedUploadKey(key) || !Number.isSafeInteger(expectedSize) || expectedSize <= 0 || expectedSize > MAX_FILE_BYTES) {
        return NextResponse.json({ error: 'Invalid verification request.' }, { status: 400 })
      }

      const url = presignOciS3Url({ method: 'HEAD', key, expiresIn: 900 })
      const response = await fetch(url, { method: 'HEAD', cache: 'no-store' })
      if (!response.ok) {
        return NextResponse.json({ error: `Remote object verification failed (${response.status}).` }, { status: 502 })
      }

      const actualSize = Number(response.headers.get('content-length'))
      const multipartSha256 = response.headers.get('opc-multipart-sha256') || response.headers.get('x-amz-checksum-sha256') || null
      const multipartMd5 = response.headers.get('opc-multipart-md5') || null
      if (!Number.isSafeInteger(actualSize) || actualSize !== expectedSize) {
        return NextResponse.json({
          ok: false,
          verified: false,
          key,
          bucket,
          expectedSize,
          actualSize: Number.isFinite(actualSize) ? actualSize : null,
          error: 'Remote object size does not match the uploaded file.',
        }, { status: 409 })
      }

      if (!multipartSha256 && !multipartMd5) {
        return NextResponse.json({
          ok: false,
          verified: false,
          key,
          bucket,
          expectedSize,
          actualSize,
          error: 'Remote object exists with the correct size, but OCI returned no multipart checksum header.',
        }, { status: 502 })
      }

      return NextResponse.json({
        ok: true,
        verified: true,
        key,
        bucket,
        expectedSize,
        actualSize,
        checksum: multipartSha256 ? { algorithm: 'SHA256', value: multipartSha256 } : { algorithm: 'MD5', value: multipartMd5 },
      })
    }

    if (action === 'abort') {
      const key = String(body.key || '')
      const uploadId = String(body.uploadId || '')
      if (!isOwnedUploadKey(key) || !uploadId) return NextResponse.json({ error: 'Invalid abort request.' }, { status: 400 })
      const url = presignOciS3Url({ method: 'DELETE', key, query: { uploadId }, expiresIn: 900 })
      const response = await fetch(url, { method: 'DELETE', cache: 'no-store' })
      await readResponse(response)
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Unknown multipart action.' }, { status: 400 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected storage error'
    console.error('[OCI multipart]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
