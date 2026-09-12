import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { buildHistoryMessages, attachmentContextSuffix } from '../src/lib/agent'
import { toolVision } from '../src/lib/tools'
import type { AttachmentMeta, ToolContext } from '../src/lib/tools'
import { composeCeoContext } from '../src/lib/ceo-context-composer'

const ROOT = join(import.meta.dir, '..')

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

describe('route.ts also informs the direct ceo_lifecycle lane about attachments, not only the orchestrator lane', () => {
  // ceo-pre-router.ts forces route:'full' whenever attachmentsCount > 0 ("Attachments require
  // contextual inspection and cannot use the direct CEO conversational lane"), but route.ts's
  // branch into the pure ceo_lifecycle path (as opposed to the operational_orchestrator path
  // that actually runs tools like `vision`) is keyed on executionContract.orchestrationOwner,
  // not on that route value -- a 'conversation'/'analysis'/'opinion' intent with an attachment
  // still resolves orchestrationOwner to 'ceo_lifecycle' (ceo-pre-router.ts's own contractFor).
  // Without this wiring, that lane's composeCeoContext call never mentions attachments at all,
  // so the model would have no way to know one exists and nothing stopping it from fabricating
  // a description of a file or image it was never shown.
  //
  // This is threaded through buildCeoContextModules/composeCeoContext's existing module system
  // (like the pre-existing evidence/execution/organization modules) rather than route.ts hand-
  // assembling a messages array itself -- tests/ceo-context-boundary-integrity.test.ts forbids
  // route-level message assembly outside the canonical composer, and rightly so.
  test('the ceo_lifecycle branch (contextModules) and the operational synthesis branch (synthesisModules) both pass attachmentContextSuffix into buildCeoContextModules', () => {
    const source = readFileSync(join(ROOT, 'src/app/api/agent/route.ts'), 'utf-8')
    expect(source).toContain("import { attachmentContextSuffix } from '@/lib/agent'")
    expect(source.match(/attachmentContextSuffix\(atts\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    expect(source).toContain('modules: contextModules')
    expect(source).toContain('modules: synthesisModules')
  })

  test('the canonical composer renders the attachments module as its own explicit, honestly-labeled context block', () => {
    const composerSource = readFileSync(join(ROOT, 'src/lib/ceo-context-composer.ts'), 'utf-8')
    expect(composerSource).toContain("'attachments'")
    expect(composerSource).toContain('ATTACHMENTS CONTEXT')
    expect(composerSource).toContain('input.modules?.attachments')
  })

  test('composeCeoContext actually renders a supplied attachments module into the message list and reports it in modules', async () => {
    const composed = await composeCeoContext({
      systemPrompt: 'You are Agent007.',
      currentUserMessage: 'what is in this photo?',
      persistedMessages: [],
      memories: [],
      modules: { attachments: attachmentContextSuffix([REMOTE_IMAGE]) },
    })
    expect(composed.modules).toContain('attachments')
    const attachmentsMessage = composed.messages.find((m) => m.content.includes('ATTACHMENTS CONTEXT'))
    expect(attachmentsMessage).toBeTruthy()
    expect(attachmentsMessage!.content).toContain('site-photo.png')
    expect(attachmentsMessage!.content).toContain('NOT read or analyzed')
  })
})
