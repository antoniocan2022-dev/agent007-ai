export const MAX_ATTACHMENT_BYTES = 10_000_000_000
export const MAX_ATTACHMENT_GIB = MAX_ATTACHMENT_BYTES / (1024 ** 3)

export type AttachmentKind = 'image' | 'audio' | 'video' | 'document' | 'archive' | 'code' | 'data' | 'other'
export type AttachmentStatus = 'TOKEN_ISSUED' | 'UPLOADING' | 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED' | 'QUARANTINED'

const MIME_PREFIXES: Array<[string, AttachmentKind]> = [
  ['image/', 'image'],
  ['audio/', 'audio'],
  ['video/', 'video'],
  ['text/', 'document'],
  ['application/pdf', 'document'],
  ['application/msword', 'document'],
  ['application/rtf', 'document'],
  ['application/vnd.openxmlformats-officedocument', 'document'],
  ['application/vnd.oasis.opendocument', 'document'],
  ['application/zip', 'archive'],
  ['application/x-7z-compressed', 'archive'],
  ['application/x-rar-compressed', 'archive'],
  ['application/gzip', 'archive'],
]

const CODE_EXTENSIONS = new Set(['js','jsx','ts','tsx','py','go','rs','java','c','h','cpp','cc','cs','php','rb','swift','kt','kts','sql','sh','bash','zsh','ps1','html','css','scss','sass','xml','yaml','yml','json','toml','ini','env','md','mdx','txt','log'])

export function sanitizeFilename(filename: string): string {
  const base = filename.replace(/[\\/\u0000-\u001f\u007f]/g, '_').trim()
  const normalized = base.normalize('NFKC').replace(/\s+/g, ' ')
  return normalized.slice(0, 240) || 'attachment'
}

export function inferAttachmentKind(contentType: string, filename: string): AttachmentKind {
  const mime = contentType.toLowerCase().split(';', 1)[0].trim()
  for (const [prefix, kind] of MIME_PREFIXES) if (mime.startsWith(prefix)) return kind
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  if (CODE_EXTENSIONS.has(ext)) return ext === 'json' || ext === 'yaml' || ext === 'yml' || ext === 'toml' ? 'data' : 'code'
  return 'other'
}

export function validateAttachmentRequest(input: { filename: string; contentType: string; size: number }): { filename: string; contentType: string; size: number; kind: AttachmentKind } {
  const filename = sanitizeFilename(input.filename)
  const contentType = (input.contentType || 'application/octet-stream').split(';', 1)[0].trim().toLowerCase() || 'application/octet-stream'
  const size = Number(input.size)
  if (!Number.isFinite(size) || size <= 0) throw new Error('Attachment size must be a positive finite number.')
  if (size > MAX_ATTACHMENT_BYTES) throw new Error(`Attachment exceeds the 10 GB per-file limit (${MAX_ATTACHMENT_BYTES} bytes).`)
  if (size > Number.MAX_SAFE_INTEGER) throw new Error('Attachment size is outside the supported integer range.')
  return { filename, contentType, size, kind: inferAttachmentKind(contentType, filename) }
}

export function processingStatusFor(kind: AttachmentKind): AttachmentStatus {
  return kind === 'other' || kind === 'archive' ? 'UPLOADED' : 'PROCESSING'
}

export function isSupportedAttachmentContentType(contentType: string): boolean {
  return Boolean(contentType && contentType.length <= 255)
}

export function buildAttachmentPath(userId: string, assetId: string, filename: string): string {
  const safe = sanitizeFilename(filename).replace(/[^A-Za-z0-9._ -]/g, '_')
  return `agent007/private/${userId}/${assetId}-${safe}`
}
