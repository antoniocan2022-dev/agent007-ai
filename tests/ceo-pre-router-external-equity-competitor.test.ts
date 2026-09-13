import { describe, expect, test } from 'bun:test'
import { preRouteCeoRequest } from '@/lib/ceo-pre-router'

const user = (content: string) => [{ role: 'user' as const, content }]

// Deep-audit fix (2026-09-13): INTERNAL_CONTEXT_RE's bare "our/we/us/my" used to unconditionally block
// isExternalEquityResearch, so "Should we buy shares of our competitor?" -- unambiguously about a
// different company's stock -- lost the equity-specific rigor (multi_source evidence, deep execution
// class, public_equity domain) reserved for genuine equity research. See ceo-pre-router.ts's
// isInternalEquityContext for the fix: an explicit external-entity word (competitor/rival) now exempts
// the message from the bare-pronoun block, while the specific internal-operations/finance nouns still
// unconditionally block it.
describe('pre-router: equity research about a named competitor survives an "our/we" pronoun', () => {
  test.each([
    'Should we buy shares of our competitor?',
    'Should we invest in our biggest rival\'s stock?',
    'Do you think we should buy our competitor\'s stock?',
  ])('classifies as public_equity research: %s', (text) => {
    const decision = preRouteCeoRequest(user(text))
    expect(decision.executionContract.domain).toBe('public_equity')
    expect(decision.executionContract.evidenceRequirement).toBe('multi_source')
  })

  test.each([
    'Should we buy more spare parts for our warehouse?',
    'Should we increase our internal budget for the team?',
    'Should we hold a review meeting about our ownership split?',
  ])('a genuinely internal financial/operations question is still excluded: %s', (text) => {
    const decision = preRouteCeoRequest(user(text))
    expect(decision.executionContract.domain).not.toBe('public_equity')
  })
})
