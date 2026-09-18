import { describe, expect, test } from 'bun:test'
import { isKnownActionTool, verifyToolAction } from '@/lib/tool-action-verification'

// Stage 4 of the CEO Conversation Kernel migration (2026-09-18): tool-action-verification.ts
// (UPGRADE #124) had no dedicated test file at all until this stage wired its output into the CEO's
// actual evidence pipeline (ceo-operational-direct-response.ts) -- previously verifyToolAction's
// result only ever fed a UI badge. isKnownActionTool is the new export this stage adds, letting a
// caller distinguish "genuinely unverified action-tool call" from "instructional tool, or a tool this
// module never expected to produce an artifact" -- both of which also report verified:false/
// artifactType:'none' from verifyToolAction but mean something different.
describe('tool-action-verification: isKnownActionTool', () => {
  test('recognizes a known action tool', () => {
    expect(isKnownActionTool('send_email')).toBe(true)
    expect(isKnownActionTool('stripe_payment_processor')).toBe(true)
  })

  test('does not recognize a non-action / discovery tool', () => {
    expect(isKnownActionTool('smart_tool_router')).toBe(false)
    expect(isKnownActionTool('memory_recall')).toBe(false)
  })
})

describe('tool-action-verification: verifyToolAction', () => {
  test('a failed action-tool call is never verified', () => {
    const result = verifyToolAction('send_email', { ok: false, preview: 'error', result: 'SMTP timeout', artifacts: [] })
    expect(result.verified).toBe(false)
  })

  test('a successful action-tool call with a real artifact (message id) is verified', () => {
    const result = verifyToolAction('send_email', { ok: true, preview: 'sent', result: 'Delivered. message_id: abc12345xy', artifacts: [] })
    expect(result.verified).toBe(true)
    expect(result.artifactType).toBe('message_id')
  })

  test('a successful action-tool call with NO artifact in its own result text is not verified -- this is the exact "claimed success, no proof" gap Stage 4 closes', () => {
    const result = verifyToolAction('send_email', { ok: true, preview: 'done', result: 'The email was sent successfully.', artifacts: [] })
    expect(result.verified).toBe(false)
    expect(result.warning).toBeTruthy()
  })

  test('a non-action tool is trivially verified (nothing to verify)', () => {
    const result = verifyToolAction('smart_tool_router', { ok: true, preview: 'ok', result: 'Recommended tools: X, Y', artifacts: [] })
    expect(result.verified).toBe(true)
    expect(result.artifactType).toBe('none')
  })
})
