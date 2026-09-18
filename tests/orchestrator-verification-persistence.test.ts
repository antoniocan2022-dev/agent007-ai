import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

// Stage 4 of the CEO Conversation Kernel migration (2026-09-18): UPGRADE #124's verifyToolAction ran
// on every orchestrator tool call and computed a real artifact-verification result, but that result
// was only ever used for the SSE `tool_result` UI event and then discarded -- nothing in
// OrchestratorRunResult carried it forward, so ceo-operational-direct-response.ts (or any other
// caller of runOrchestrator()) had no way to use it. Stage 4 persists it onto each step.
//
// orchestrator.ts is not live-importable in this sandbox (its real dependency graph -- Prisma, auth,
// dozens of live tool integrations -- isn't installed here), the same constraint documented elsewhere
// in this suite (see orchestrator-identity-reminder-hoist.test.ts) -- so this is a source-text
// structural test.
describe('orchestrator.ts persists verifyToolAction\'s result onto each step (Stage 4)', () => {
  const source = readFileSync('src/lib/orchestrator.ts', 'utf8')

  test('OrchestratorRunResult.steps[] declares a verification field', () => {
    expect(source).toContain('verification?: ToolVerificationResult')
  })

  test('the tool-call loop assigns the computed verification onto the step object, not just the emit call', () => {
    const verifyCallIndex = source.indexOf('const verification = verifyToolAction(')
    expect(verifyCallIndex).toBeGreaterThan(-1)
    const assignmentIndex = source.indexOf('step.verification = verification')
    expect(assignmentIndex).toBeGreaterThan(-1)
    // The assignment must happen after verification is computed, and before the emit call that used
    // to be its only consumer -- otherwise a caller reading step.verification could see a stale or
    // undefined value depending on timing.
    const emitIndex = source.indexOf("await emit('tool_result',")
    expect(assignmentIndex).toBeGreaterThan(verifyCallIndex)
    expect(assignmentIndex).toBeLessThan(emitIndex)
  })

  test('ToolVerificationResult is imported as a type from tool-action-verification', () => {
    expect(source).toContain("import { verifyToolAction, type ToolVerificationResult } from \"./tool-action-verification\"")
  })
})
