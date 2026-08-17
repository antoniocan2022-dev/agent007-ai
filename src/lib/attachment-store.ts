import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { getObjectStorageConfig, createMultipartUpload, abortMultipartUpload, completeMultipartUpload, headObject, listMultipartParts, presignObjectPart, type MultipartPart } from '@/lib/object-storage'
import { validateAttachmentRequest, type AttachmentKind, type AttachmentStatus, partSizeForSize, MAX_ATTACHMENT_BYTES } from '@/lib/attachment-policy'

const PREFIX = 'attachment:asset:'
const idempotencyPrefix = 'attachment:idempotency:'

export interface AttachmentAssetRecord {
  id: string
  userId: string
  conversationId: string | null
  originalName: string
  safeName: string
  mimeType: string
  kind: AttachmentKind
  size: number
  storageKey: string
  storageProvider: 's3-compatible'
  status: AttachmentStatus
  multipartUploadId: string | null
  partSize: number
  partCount: number
  completedParts: number
  etag: string | null
  contentTypeVerified: boolean
  downloadOnly: boolean
  checksumSha256: string | null
  quarantineReason: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

function assetKey(id: string) { return `${PREFIX}${id}` }
function idempotencyKey(userId: string, key: string) { return `${idempotencyPrefix}${userId}:${key}` }
function now() { return new Date().toISOString() }
function safeDispositionName(name: string) { return name.replace(/[\r\n\"\\]/g, '_').slice(0, 180) }

function parseRecord(value: string): AttachmentAssetRecord {
  const record = JSON.parse(value) as AttachmentAssetRecord
  if (!record?.id || !record?.userId || !record?.storageKey) throw new Error('Attachment metadata record is malformed.')
  return record
}

async function readRecord(id: string): Promise<AttachmentAssetRecord | null> {
  const row = await db.memory.findUnique({ where: { key: assetKey(id) } })
  return row ? parseRecord(row.value) : null
}

export async function getAttachmentAsset(id: string, userId: string): Promise<AttachmentAssetRecord> {
  const record = await readRecord(id)
  if (!record) throw new Error('Attachment not found.')
  if (record.userId !== userId) throw new Error('Attachment ownership mismatch.')
  return record
}

async function saveRecord(record: AttachmentAssetRecord) {
  await db.memory.upsert({ where: { key: assetKey(record.id) }, update: { value: JSON.stringify(record), category: 'attachment_asset' }, create: { key: assetKey(record.id), value: JSON.stringify(record), category: 'attachment_asset' } })
}

export async function initiateAttachment(input: { userId: string; conversationId?: string | null; filename: string; mimeType?: string | null; size: number; clientRequestId?: string | null }) {
  const validated = validateAttachmentRequest({ filename: input.filename, mimeType: input.mimeType, size: input.size })
  if (validated.size > MAX_ATTACHMENT_BYTES) throw new Error('Attachment exceeds the configured maximum.')
  const objectStorage = getObjectStorageConfig()
  const clientRequestId = input.clientRequestId?.trim()
  if (clientRequestId) {
    const existingIdRow = await db.memory.findUnique({ where: { key: idempotencyKey(input.userId, clientRequestId) } })
    if (existingIdRow) {
      const existing = await readRecord(existingIdRow.value)
      if (existing) return { asset: existing, reused: true }
    }
  }
  const id = randomUUID()
  const storageKey = `agent007/private/${input.userId}/${id}/${validated.filename.replace(/[^A-Za-z0-9._ -]/g, '_')}`
  const uploadId = await createMultipartUpload(storageKey, validated.mimeType)
  const timestamp = now()
  const record: AttachmentAssetRecord = {
    id, userId: input.userId, conversationId: input.conversationId ?? null, originalName: input.filename, safeName: validated.filename, mimeType: validated.mimeType,
    kind: validated.kind, size: validated.size, storageKey, storageProvider: 's3-compatible', status: 'UPLOADING', multipartUploadId: uploadId,
    partSize: partSizeForSize(validated.size), partCount: validated.partCount, completedParts: 0, etag: null, contentTypeVerified: false,
    downloadOnly: validated.downloadOnly, checksumSha256: null, quarantineReason: null, createdAt: timestamp, updatedAt: timestamp, completedAt: null,
  }
  await saveRecord(record)
  if (clientRequestId) await db.memory.upsert({ where: { key: idempotencyKey(input.userId, clientRequestId) }, update: { value: id, category: 'attachment_idempotency' }, create: { key: idempotencyKey(input.userId, clientRequestId), value: id, category: 'attachment_idempotency' } })
  return { asset: record, reused: false, objectStorage: { region: objectStorage.region, bucketConfigured: true } }
}

export async function presignAttachmentPart(id: string, userId: string, partNumber: number): Promise<{ url: string; partNumber: number; expiresIn: number }> {
  const record = await getAttachmentAsset(id, userId)
  if (record.status !== 'UPLOADING') throw new Error(`Attachment is not uploadable in state ${record.status}.`)
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > record.partCount) throw new Error('Invalid multipart part number.')
  if (!record.multipartUploadId) throw new Error('Multipart upload session is missing.')
  const expiresIn = 900
  return { url: presignObjectPart('PUT', record.storageKey, { partNumber: String(partNumber), uploadId: record.multipartUploadId }, expiresIn), partNumber, expiresIn }
}

export async function attachmentStatus(id: string, userId: string) {
  const record = await getAttachmentAsset(id, userId)
  const parts = record.multipartUploadId && record.status === 'UPLOADING' ? await listMultipartParts(record.storageKey, record.multipartUploadId) : []
  return { asset: { ...record, size: Number(record.size) }, parts }
}

export async function completeAttachment(id: string, userId: string, parts: MultipartPart[]) {
  const record = await getAttachmentAsset(id, userId)
  if (!record.multipartUploadId) throw new Error('Multipart upload session is missing.')
  if (record.status !== 'UPLOADING') {
    if (['UPLOADED', 'PROCESSING', 'READY'].includes(record.status)) return record
    throw new Error(`Attachment cannot be completed from state ${record.status}.`)
  }
  if (parts.length !== record.partCount) throw new Error(`Expected ${record.partCount} uploaded parts, received ${parts.length}.`)
  const actualParts = await listMultipartParts(record.storageKey, record.multipartUploadId)
  const actualByPart = new Map(actualParts.map((part) => [part.partNumber, part]))
  for (const part of parts) {
    const actual = actualByPart.get(part.partNumber)
    if (!actual || actual.etag.replace(/\"/g, '') !== part.etag.replace(/\"/g, '')) throw new Error(`Uploaded part ${part.partNumber} is not present with the expected ETag.`)
  }
  const etag = await completeMultipartUpload(record.storageKey, record.multipartUploadId, parts)
  const head = await headObject(record.storageKey)
  if (head.size !== record.size) {
    record.status = 'QUARANTINED'
    record.quarantineReason = `Storage object size mismatch: expected ${record.size}, got ${head.size}.`
    record.updatedAt = now()
    await saveRecord(record)
    throw new Error(record.quarantineReason)
  }
  record.status = 'UPLOADED'
  record.completedParts = record.partCount
  record.etag = etag ?? head.etag
  record.contentTypeVerified = Boolean(head.contentType && head.contentType.toLowerCase().split(';', 1)[0] === record.mimeType)
  record.updatedAt = now()
  record.completedAt = record.updatedAt
  await saveRecord(record)
  return record
}

export async function abortAttachment(id: string, userId: string) {
  const record = await getAttachmentAsset(id, userId)
  if (record.multipartUploadId && record.status === 'UPLOADING') await abortMultipartUpload(record.storageKey, record.multipartUploadId)
  record.status = 'ABORTED'
  record.updatedAt = now()
  await saveRecord(record)
  return record
}

export async function signedAttachmentDownload(id: string, userId: string): Promise<string> {
  const record = await getAttachmentAsset(id, userId)
  if (!['UPLOADED', 'PROCESSING', 'READY'].includes(record.status)) throw new Error(`Attachment is not downloadable in state ${record.status}.`)
  const filename = safeDispositionName(record.safeName)
  const query: Record<string, string> = { 'response-content-disposition': `${record.downloadOnly ? 'attachment' : 'inline'}; filename="${filename}"`, 'response-content-type': record.downloadOnly ? 'application/octet-stream' : record.mimeType }
  return presignObjectPart('GET', record.storageKey, query, 600)
}
