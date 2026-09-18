import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

// Stage 1a of the CEO Conversation Kernel migration (2026-09-18): runOrchestrator()'s identity-
// reminder classification (STRATEGIC_KEYWORDS detection -> 4 parallel diagnostic API fetches ->
// cognitive-framework classification) used to run fresh on EVERY iteration of the up-to-50-
// iteration tool loop, even though it depends only on `userMessage` -- constant across iterations,
// never on the accumulating tool results or conversation state that DO change per iteration. For
// any multi-step action this loop exists to handle, that meant the same 4 HTTP round trips and the
// same classification pass firing once per iteration for an input that couldn't have changed.
//
// orchestrator.ts is not live-importable in this sandbox (its real dependency graph -- Prisma,
// auth, dozens of live tool integrations -- isn't installed here), so this is a source-text
// structural test, the same convention already used elsewhere in this suite for exactly this
// class of sandbox-untestable code: it verifies the classification block now appears textually
// BEFORE the tool loop starts (computed once) and that the loop body no longer contains its own
// copy of the classification logic (no re-declaration, no re-fetch, no re-import).
describe('orchestrator.ts identity-reminder classification is computed once, not per tool-loop iteration', () => {
  const source = readFileSync('src/lib/orchestrator.ts', 'utf8')
  const loopStart = source.indexOf('while (iter < MAX_ITERATIONS) {')
  const strategicKeywordsDecl = source.indexOf('const STRATEGIC_KEYWORDS =')
  const cognitivePipelineImport = source.indexOf("await import('./cognitive-framework')")
  const identityReminderDecl = source.indexOf('const identityReminder = cognitiveContext || fallbackReminder')

  test('the tool loop exists and all four markers are present', () => {
    expect(loopStart).toBeGreaterThan(-1)
    expect(strategicKeywordsDecl).toBeGreaterThan(-1)
    expect(cognitivePipelineImport).toBeGreaterThan(-1)
    expect(identityReminderDecl).toBeGreaterThan(-1)
  })

  test('STRATEGIC_KEYWORDS is declared before the loop starts, not inside it', () => {
    expect(strategicKeywordsDecl).toBeLessThan(loopStart)
  })

  test('the cognitive-framework classification runs before the loop starts, not inside it', () => {
    expect(cognitivePipelineImport).toBeLessThan(loopStart)
  })

  test('identityReminder is finalized before the loop starts, not inside it', () => {
    expect(identityReminderDecl).toBeLessThan(loopStart)
  })

  test('the loop body uses the precomputed identityReminder, without redeclaring the classification', () => {
    const loopBody = source.slice(loopStart)
    // The loop body legitimately mentions "identityReminder" twice: once in the explanatory
    // comment (added alongside the hoist) and once in the actual
    // `{ role: 'user' as const, content: identityReminder }` usage -- neither is a second
    // computation. What would signal a regression back to per-iteration recomputation is a
    // second DECLARATION of the classification (`const STRATEGIC_KEYWORDS =` or a fresh
    // cognitive-framework import) inside the loop body, which this checks directly.
    expect(loopBody.includes('content: identityReminder')).toBe(true)
    expect(loopBody.includes('const STRATEGIC_KEYWORDS =')).toBe(false)
    expect(loopBody.includes("await import('./cognitive-framework')")).toBe(false)
  })

  // The dead `toolCountForReminder` variable (computed but never read, left over from a reminder
  // format UPGRADE #217 replaced) is fully removed as CODE, not just moved. It's still named in
  // this file's own explanatory comment about the removal, so check for the declaration/usage
  // forms specifically rather than the bare identifier string.
  test('the dead toolCountForReminder variable is gone as code (declaration and usage, not just mentioned in a comment)', () => {
    expect(source.includes('toolCountForReminder =')).toBe(false)
    expect(source.includes('String(toolCountForReminder')).toBe(false)
  })
})
