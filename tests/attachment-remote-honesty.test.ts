import { describe, expect, test } from 'bun:test'
import { buildHistoryMessages } from '../src/lib/agent'
import { toolVision } from '../src/lib/tools'
import type { AttachmentMeta, ToolContext } from '../src/lib/tools'

const REMOTE_ATTACHMENT: AttachmentMeta = {
  filename: 'uploads/2026/user1-key-report.pdf',
  originalName: 'quarterly-report.pdf',
  mimeType: 'application/pdf',
  size: 5_368_709_120,
  remote: { provider: 'oci', bucket: 'attachments', key: 'uploads/2026/user1-key-report.pdf', checksum: { algorithm: 'SHA256', value: 'deadbeef' } },
}

const REMOTE_IMAGE: AttachmentMeta = {
  filename: 'uploads/2026/user1-key-photo.png',
  originalName: 'site-photo.png',
  mimeType: 'image/png',
  size: 900_000_000,
  remote: { provider: 'oci', bucket: 'attachments', key: 'uploads/2026/user1-key-photo.png', checksum: { algorithm: 'SHA256', value: 'cafebabe' } },
}

const INLINE_IMAGE: AttachmentMeta = {
  filename: 'small.png',
  originalName: 'small.png',
  mimeType: 'image/png',
  size: 1024,
  dataUrl: 'data:image/png;base64,AAAA',
}

describe('buildHistoryMessages honestly announces remote-only attachments (does not fabricate that they were read)', () => {
  test('a remote-only file is announced by name/size with an explicit "not read or analyzed" instruction, never inlined as content', async () => {
    const messages = await buildHistoryMessages('nonexistent-conversation-id', 'please review the attached file', [REMOTE_ATTACHMENT])
    const userMessage = messages[messages.length - 1]
    expect(userMessage.content).toContain('quarterly-report.pdf')
    expect(userMessage.content).toContain('NOT read or analyzed')
    expect(userMessage.content).toContain('Do not describe or summarize their contents')
  })

  test('a remote-only image does NOT get the "use vision tool" hint (vision cannot see it), only the honest remote-file notice', async () => {
    const messages = await buildHistoryMessages('nonexistent-conversation-id', 'what is in this photo?', [REMOTE_IMAGE])
    const userMessage = messages[messages.length - 1]
    expect(userMessage.content).not.toContain('Use the vision tool')
    expect(userMessage.content).toContain('site-photo.png')
    expect(userMessage.content).toContain('NOT read or analyzed')
  })

  test('an inline image with a real dataUrl still gets the vision-tool hint as before', async () => {
    const messages = await buildHistoryMessages('nonexistent-conversation-id', 'what is in this photo?', [INLINE_IMAGE])
    const userMessage = messages[messages.length - 1]
    expect(userMessage.content).toContain('Use the vision tool')
    expect(userMessage.content).not.toContain('NOT read or analyzed')
  })
})

describe('toolVision refuses honestly on remote-only images instead of silently finding nothing', () => {
  const ctx = (attachments: AttachmentMeta[]): ToolContext => ({ attachments, language: 'en' })

  test('a remote-only image attachment produces a specific explanation, not the generic "no image attached" message', async () => {
    const result = await toolVision({}, ctx([REMOTE_IMAGE]))
    expect(result.ok).toBe(false)
    expect(result.result).toContain('site-photo.png')
    expect(result.result).toContain('durable object storage')
    expect(result.result).not.toContain('Ask the user to attach an image first')
  })

  test('truly no image attached still gives the original generic message', async () => {
    const result = await toolVision({}, ctx([]))
    expect(result.ok).toBe(false)
    expect(result.result).toContain('Ask the user to attach an image first')
  })
})
