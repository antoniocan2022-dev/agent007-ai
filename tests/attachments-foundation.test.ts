import { describe, expect, test } from 'bun:test'
import { classifyAttachment, MAX_ATTACHMENT_BYTES, MULTIPART_PART_BYTES, partSizeForSize, validateAttachmentRequest } from '@/lib/attachment-policy'
import { presignObjectPart } from '@/lib/object-storage'

describe('universal attachment foundation', () => {
  test('accepts exactly 10 GB and rejects larger payloads', () => {
    const exact = validateAttachmentRequest({ filename: 'video.mp4', mimeType: 'video/mp4', size: MAX_ATTACHMENT_BYTES })
    expect(exact.size).toBe(MAX_ATTACHMENT_BYTES)
    expect(() => validateAttachmentRequest({ filename: 'too-large.bin', mimeType: 'application/octet-stream', size: MAX_ATTACHMENT_BYTES + 1 })).toThrow(/10 GB/)
  })

  test('uses a bounded multipart part size', () => {
    expect(partSizeForSize(1)).toBe(MULTIPART_PART_BYTES)
    const tenGb = validateAttachmentRequest({ filename: 'large.bin', mimeType: 'application/octet-stream', size: MAX_ATTACHMENT_BYTES })
    expect(tenGb.partCount).toBe(Math.ceil(MAX_ATTACHMENT_BYTES / MULTIPART_PART_BYTES))
    expect(tenGb.partCount).toBeLessThan(10_000)
  })

  test('classifies common media and permits unknown binary types', () => {
    expect(classifyAttachment('image/png', 'picture.png')).toBe('IMAGE')
    expect(classifyAttachment('audio/mpeg', 'audio.mp3')).toBe('AUDIO')
    expect(classifyAttachment('video/mp4', 'video.mp4')).toBe('VIDEO')
    expect(classifyAttachment('application/pdf', 'document.pdf')).toBe('DOCUMENT')
    expect(classifyAttachment('application/octet-stream', 'custom.xyz')).toBe('OTHER')
  })

  test('sanitizes names and marks executable/renderable content as download-only', () => {
    const html = validateAttachmentRequest({ filename: '../unsafe<script>.html', mimeType: 'text/html', size: 100 })
    expect(html.filename).not.toContain('/')
    expect(html.downloadOnly).toBe(true)
  })

  test('generates a bounded signed-storage URL without contacting storage', () => {
    process.env.ATTACHMENT_S3_ENDPOINT = 'https://storage.example.test'
    process.env.ATTACHMENT_S3_BUCKET = 'agent007'
    process.env.ATTACHMENT_S3_REGION = 'us-east-1'
    process.env.ATTACHMENT_S3_ACCESS_KEY_ID = 'test-access'
    process.env.ATTACHMENT_S3_SECRET_ACCESS_KEY = 'test-secret'
    process.env.ATTACHMENT_S3_FORCE_PATH_STYLE = 'true'
    const url = presignObjectPart('PUT', 'agent007/private/u/a/file.bin', { partNumber: '1', uploadId: 'upload-1' })
    const parsed = new URL(url)
    expect(parsed.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
    expect(parsed.searchParams.get('X-Amz-Credential')).toContain('test-access/')
    expect(parsed.searchParams.get('partNumber')).toBe('1')
  })
})
