/** Canonical safety and capacity policy for universal attachments. */

export const MAX_ATTACHMENT_BYTES = 10_000_000_000
export const MAX_ATTACHMENT_GB = 10
export const MULTIPART_PART_BYTES = 32 * 1024 * 1024
export const MAX_MULTIPART_PARTS = 10_000
export const MAX_FILENAME_CHARS = 255

export const ATTACHMENT_STATUSES = ['INITIATED', 'UPLOADING', 'UPLOADED', 'QUARANTINED', 'PROCESSING', 'READY', 'FAILED', 'ABORTED'] as const
export type AttachmentStatus = typeof ATTACHMENT_STATUSES[number]
export type AttachmentKind = 'IMAGE' | 'AUDIO' | 'VIDEO' | 'DOCUMENT' | 'ARCHIVE' | 'CODE' | 'DATA' | 'OTHER'

const CODE_EXTENSIONS = new Set(['js','jsx','ts','tsx','py','go','rs','java','c','h','cpp','hpp','cc','cs','php','rb','swift','kt','kts','sql','sh','bash','zsh','ps1','html','css','scss','sass','xml','yaml','yml','json','toml','ini','env','md','mdx','txt','log'])
const ARCHIVE_EXTENSIONS = new Set(['zip','rar','7z','tar','gz','bz2','xz','tgz'])
const DOCUMENT_EXTENSIONS = new Set(['pdf','doc','docx','rtf','odt','xls','xlsx','ods','ppt','pptx','odp','txt','md','csv','json','xml','yaml','yml'])

export function normalizeAttachmentName(name: string): string {
  const normalized = name.normalize('NFKC').replace(/[\u0000-\u001F\u007F]/g, '_').trim()
  return (normalized.replace(/[\\/]/g, '_').replace(/^\.+/, '') || 'attachment').slice(0, MAX_FILENAME_CHARS)
}

export function classifyAttachment(mimeType: string, filename: string): AttachmentKind {
  const mime = mimeType.toLowerCase().split(';', 1)[0].trim()
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  if (mime.startsWith('image/')) return 'IMAGE'
  if (mime.startsWith('audio/')) return 'AUDIO'
  if (mime.startsWith('video/')) return 'VIDEO'
  if (ARCHIVE_EXTENSIONS.has(ext) || mime.includes('zip') || mime.includes('compressed')) return 'ARCHIVE'
  if (CODE_EXTENSIONS.has(ext)) return ['json', 'yaml', 'yml', 'toml'].includes(ext) ? 'DATA' : 'CODE'
  if (DOCUMENT_EXTENSIONS.has(ext) || mime === 'application/pdf' || mime.startsWith('text/')) return 'DOCUMENT'
  if (mime.startsWith('application/json') || mime.startsWith('application/xml')) return 'DATA'
  return 'OTHER'
}

export function isDownloadOnlyKind(mimeType: string, filename: string): boolean {
  const mime = mimeType.toLowerCase().split(';', 1)[0].trim()
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  return mime === 'text/html' || mime === 'image/svg+xml' || ['html', 'htm', 'svg', 'js', 'mjs', 'cjs'].includes(ext)
}

export function validateAttachmentRequest(input: { filename: string; mimeType?: string | null; size: number }) {
  const filename = normalizeAttachmentName(input.filename)
  const mimeType = (input.mimeType || 'application/octet-stream').toLowerCase().split(';', 1)[0].trim() || 'application/octet-stream'
  if (!filename) throw new Error('Attachment filename is required.')
  if (!Number.isSafeInteger(input.size) || input.size <= 0) throw new Error('Attachment size must be a positive integer byte count.')
  if (input.size > MAX_ATTACHMENT_BYTES) throw new Error(`Attachment exceeds the ${MAX_ATTACHMENT_GB} GB per-file limit.`)
  const partCount = Math.ceil(input.size / MULTIPART_PART_BYTES)
  if (partCount > MAX_MULTIPART_PARTS) throw new Error('Attachment exceeds the multipart part-count safety limit.')
  return { filename, mimeType, size: input.size, kind: classifyAttachment(mimeType, filename), downloadOnly: isDownloadOnlyKind(mimeType, filename), partCount }
}

export function partSizeForSize(size: number): number {
  void size
  return MULTIPART_PART_BYTES
}
