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
  test('excludes common role and platform acronyms from concise ticker research', () => {
    for (const text of ['Research CEO', 'Research CFO', 'Research API', 'Research AWS', 'Analyze ML']) {
      const decision = preRouteCeoRequest(user(text))
      expect(decision.executionContract.domain).not.toBe('public_equity')
    }
  })

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

// Production incident (2026-09-17): a real user asked "can you give me updates about 2 stocks, GEOS
// and MIND tecnology, in your own words" and, in a follow-up turn, "yes, today I want ... a full
// understanding of 2 stock, GEOS and MIND Tecnologi ... Give me the best of the best of you." Both
// named two real tickers plus the word "stocks", yet fell all the way through inferSemanticIntent to
// plain 'conversation' -- MARKET_ACTION_RE/MARKET_RESEARCH_LOOKUP_RE only recognized an analytical verb
// (analyze/research/compare/...) or a check/pull/gather+news/updates phrasing, never the far more common
// way people actually ask for information (give/tell/share/update/brief/"full understanding"/etc). With
// intent misclassified as 'conversation', evidenceClass/domain/toolRequired were all forced to
// 'none'/'none'/false -- no evidence-gathering tool (including the real market-data dispatch path fixed
// in the immediately preceding round) was ever reachable, regardless of how well it worked, because the
// request never got routed there in the first place.
describe('pre-router: external equity finance language is not falsely classified as internal context', () => {
  test.each([
    'Tell me about GEOS earnings.',
    'Give me the latest earnings update for GEOS.',
    'Review GEOS cash flow forecast.',
    'Explain the financials for GEOS.',
  ])('keeps external company finance wording eligible for public-equity research: %s', (text) => {
    const decision = preRouteCeoRequest(user(text))
    expect(decision.executionContract.domain).toBe('public_equity')
    expect(decision.executionContract.evidenceRequirement).toBe('multi_source')
    expect(decision.executionContract.toolRequired).toBe(true)
  })

  test.each([
    'Tell me about our earnings report.',
    'Explain our financials.',
    'Review our budget forecast.',
  ])('keeps clearly internal finance wording out of public-equity research: %s', (text) => {
    const decision = preRouteCeoRequest(user(text))
    expect(decision.executionContract.domain).not.toBe('public_equity')
  })
})

describe('pre-router: contextual ticker safety remains case-sensitive and acronym-aware', () => {
  test('does not promote lowercase short words to ticker research', () => {
    const decision = preRouteCeoRequest(user('Tell me about geos earnings.'))
    expect(decision.executionContract.domain).not.toBe('public_equity')
  })

  test.each(['Tell me about API earnings.', 'Explain CEO compensation.', 'Review SEC filings.'])('does not promote common acronyms to ticker research: %s', (text) => {
    const decision = preRouteCeoRequest(user(text))
    expect(decision.executionContract.domain).not.toBe('public_equity')
  })
})

describe('pre-router: concise uppercase-ticker research remains public-equity research', () => {
  test.each([
    'Research GEOS',
    'research AAPL',
    'Review NVDA',
  ])('classifies a concise uppercase-ticker research request as public equity: %s', (text) => {
    const decision = preRouteCeoRequest(user(text))
    expect(decision.executionContract.intent).toBe('research')
    expect(decision.executionContract.domain).toBe('public_equity')
    expect(decision.executionContract.evidenceRequirement).toBe('multi_source')
    expect(decision.executionContract.toolRequired).toBe(true)
  })

  test.each([
    'Research API',
    'Analyze CPU',
    'Review CEO compensation',
  ])('does not promote common acronyms or role terms to public-equity research: %s', (text) => {
    const decision = preRouteCeoRequest(user(text))
    expect(decision.executionContract.domain).not.toBe('public_equity')
  })
})

describe('pre-router: a natural information-request ("give me updates on X", "tell me about X") about a named stock is real research, not conversation', () => {
  test.each([
    'can you give me updates about 2 stocks, GEOS and MIND tecnology, in your own words.',
    'yes, today I want you can make a full understanding of 2 stock, GEOS and MIND Tecnologi, but in your own words. Give me the best of the best of you.',
    'Tell me about NVDA stock.',
    'Share an update on AAPL shares.',
  ])('classifies as public_equity research, routed to the governed evidence path: %s', (text) => {
    const decision = preRouteCeoRequest(user(text))
    expect(decision.executionContract.intent).toBe('research')
    expect(decision.executionContract.domain).toBe('public_equity')
    expect(decision.executionContract.evidenceProfile).toBe('public_equity')
    expect(decision.executionContract.toolRequired).toBe(true)
    expect(decision.route).toBe('full')
  })

  test.each([
    'Should we buy more spare parts for our warehouse?',
    'Give me an update on our internal budget for the team.',
    'Tell me about our ownership split.',
  ])('an ordinary internal information request stays excluded even with an info-request verb: %s', (text) => {
    const decision = preRouteCeoRequest(user(text))
    expect(decision.executionContract.domain).not.toBe('public_equity')
  })
})
