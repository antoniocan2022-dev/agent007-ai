import { describe, expect, test } from 'bun:test'
import { isKnownActionTool, isResearchTool, summarizeToolExecutionVerification, verifyToolAction } from '@/lib/tool-action-verification'

// Stage 4 of the CEO Conversation Kernel migration (2026-09-18): verifyToolAction now feeds the CEO
// execution handoff, not only a UI badge. isKnownActionTool distinguishes genuinely consequential
// action tools from instructional/research tools, and the execution summary below is the shared
// authority for interactive and scheduled RESPOND lanes.
// // caller distinguish "genuinely unverified action-tool call" from "instructional tool, or a tool this
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

  // Phase 2 fix (external audit, 2026-09-19), issue 5: http_fetch/web_search/page_reader only ever
  // READ external state -- a successful call is not evidence of a completed real-world action, so they
  // must not count as a "known action tool" for LIVE_VERIFIED eligibility purposes even though
  // verifyToolAction below still checks their result text for an incidental artifact.
  test('does not recognize a read/research tool as an outcome-producing action (issue 5)', () => {
    expect(isKnownActionTool('http_fetch')).toBe(false)
    expect(isKnownActionTool('web_search')).toBe(false)
    expect(isKnownActionTool('page_reader')).toBe(false)
    expect(isResearchTool('http_fetch')).toBe(true)
    expect(isResearchTool('web_search')).toBe(true)
    expect(isResearchTool('page_reader')).toBe(true)
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

  // Phase 2 fix (external audit, 2026-09-19), issue 3: presence of SOME artifact is not the same as
  // presence of the RIGHT kind of artifact for what this tool's real outcome is supposed to produce -- a
  // send_email result whose text happens to contain a URL (a link in the email body, say) does not
  // confirm an email was actually sent; only a message id does.
  test('a send_email result containing the WRONG artifact type (a URL, not a message id) is not verified (issue 3)', () => {
    const result = verifyToolAction('send_email', { ok: true, preview: 'sent', result: 'Delivered a link to https://example.com/offer in the body.', artifacts: [] })
    expect(result.verified).toBe(false)
    expect(result.artifactType).toBe('url')
    expect(result.warning).toBeTruthy()
    expect(result.warning).toContain('does not confirm')
  })

  test('a stripe_payment_processor result with a URL instead of a transaction id is not verified (issue 3)', () => {
    const result = verifyToolAction('stripe_payment_processor', { ok: true, preview: 'ok', result: 'See the receipt at https://dashboard.stripe.com/receipts/abc123', artifacts: [] })
    expect(result.verified).toBe(false)
    expect(result.artifactType).toBe('url')
  })

  test('a stripe_payment_processor result with the correct transaction id IS verified (issue 3, positive case)', () => {
    const result = verifyToolAction('stripe_payment_processor', { ok: true, preview: 'ok', result: 'Charged successfully. tx_9f8a7b6c5d4e', artifacts: [] })
    expect(result.verified).toBe(true)
    expect(result.artifactType).toBe('transaction_id')
  })

  // A tool with no EXPECTED_ARTIFACT_TYPES entry keeps the original permissive "any artifact counts"
  // behavior -- issue 3's fix narrows acceptance only for tools it has an explicit opinion about.
  test('a tool with no expected-artifact-type mapping keeps the permissive any-artifact-counts behavior', () => {
    const result = verifyToolAction('web_search', { ok: true, preview: 'ok', result: 'Top result: https://example.com/article', artifacts: [] })
    expect(result.verified).toBe(true)
    expect(result.artifactType).toBe('url')
  })
})
