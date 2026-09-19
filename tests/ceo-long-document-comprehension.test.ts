import { describe, expect, test } from 'bun:test'
import { composeCeoContext } from '@/lib/ceo-context-composer'
import { evaluateCeoQuality } from '@/lib/ceo-response-quality-gate'
import { extractInstructionWindow, CEO_MESSAGE_CLAMP_CHARS } from '@/lib/ceo-cognitive-contract'
import { buildCanonicalConversationContext } from '@/lib/ceo-cognitive-conversation'
import { buildConversationDecisionContract } from '@/lib/ceo-conversation-decision-contract'
import { deriveCeoConversationState } from '@/lib/ceo-conversation-state'

// Production incident (2026-09-19): "make a deep analysis of this text and tell me in your own words what
// you think" over a long pasted document degraded on every attempt to a canned "I couldn't complete the
// challenge path reliably..." response. Root-caused to three compounding failures, all over long pasted
// text specifically:
//   1. actionFor() (ceo-conversation-decision-contract.ts) and userIntentHint()
//      (ceo-cognitive-conversation.ts) used to scan the ENTIRE raw message for words like
//      "challenge"/"deploy"/"verify"/"recommend" before ever looking at what the user actually asked --
//      so a long, substantive document that happens to use one of those words anywhere in its body
//      (extremely common in ordinary prose) could hijack intent/responseAction away from the user's real
//      request, regardless of where in the document the word appears.
//   2. Even when classification was correct, objectiveCoverage's 25% lexical-overlap requirement rejected
//      a genuine, concise comprehension answer just because it didn't reuse enough of the SOURCE
//      document's own vocabulary -- a meaningless signal for a synthesis/summary task.
//   3. MAX_MESSAGE_CHARS (formerly 12,000, a head-only slice with no truncation marker) silently dropped
//      the tail of any longer paste before any of this reasoning even ran.
// This fixture reconstructs a realistic long paste (a business report, comfortably exceeding the old
// 12,000-char clamp) that naturally uses "challenge" only in its middle section, and locks in that the
// fixed pipeline classifies and judges a plain "deep analysis" request over it correctly end to end.

function longBusinessReport(): string {
  const opening = 'Q3 Strategic Review: Market Position and Platform Roadmap'
  const early = [
    'Our platform grew subscription revenue by 14% quarter over quarter, driven primarily by expansion in the mid-market segment. Customer retention held steady at 92%, though churn in the smallest accounts ticked up slightly, which the finance team attributes to seasonal budget cycles rather than a product issue.',
    'On the product side, the engineering organization shipped the new analytics dashboard ahead of the original timeline and completed the migration of the billing subsystem without customer-visible downtime. The support team reports a measurable drop in ticket volume related to onboarding, which we credit to the revised setup wizard shipped in July.',
  ]
  // "challenge" appears once, naturally, deep in the middle of the document -- far from both the head
  // and tail instruction windows a short framing message would occupy.
  const middleWithChallenge =
    'The competitive landscape remains a genuine challenge for the category as a whole: two well-funded entrants launched comparable offerings this quarter, and several existing competitors cut pricing on their entry tiers. Our own pricing committee reviewed the data and does not recommend matching those cuts directly, since our differentiated support tier continues to justify a premium in every win/loss interview we have run this quarter.'
  const filler = 'Customer support satisfaction scores remained within the target band this quarter, and the team continues to track response-time metrics against the service-level targets set at the start of the year. No material staffing changes are planned for the support organization in the near term.'
  const fillerParagraphs = Array.from({ length: 40 }, (_, index) => `${filler} (operational note ${index + 1} of 40.)`)
  const late = [
    'Marketing research into the mid-market segment shows continued appetite for deeper integrations with existing accounting software, and the partnerships team has three integration proposals in active discussion. None of these are contractually committed yet, so they should be treated as pipeline, not booked revenue.',
    'Operationally, the infrastructure team completed the planned failover testing across both regions with no unplanned incidents, and the security team closed out the remaining findings from the external audit conducted in May.',
    'Looking ahead, the leadership team\'s working view favors prioritizing deepening the mid-market integrations pipeline over pursuing new enterprise logos in the next two quarters, given the stronger near-term return on the integrations work and the smaller sales-cycle risk it carries relative to enterprise deals currently in early discovery.',
  ]
  return [opening, ...early, middleWithChallenge, ...fillerParagraphs, ...late].join('\n\n')
}

const REPORT = longBusinessReport()
const PLAIN_ANALYSIS_INSTRUCTION = 'Make a deep analysis and tell me in your own words, what do you think about this report?'
const PLAIN_ANALYSIS_MESSAGE = `${PLAIN_ANALYSIS_INSTRUCTION}\n\n${REPORT}`
// Deliberately avoids a leading "this" ("read this report...") -- that trips a separate, pre-existing
// bug in resolveConversationReferences (ceo-conversation-state.ts), which flags a demonstrative pronoun
// as an ambiguous cross-turn reference even when it's immediately followed by its own referent noun in
// the same sentence, forcing clarificationRequired before responseAction classification ever runs. Out
// of scope for this incident (a keyword-scanning bug, not a reference-resolution bug) -- tracked
// separately.
const EXPLICIT_CHALLENGE_MESSAGE = `Please challenge the report's conclusion about pricing below.\n\n${REPORT}`

describe('extractInstructionWindow: sizing sanity', () => {
  test('the fixture document comfortably exceeds the old 12,000-char clamp, so this suite actually exercises the truncation fix', () => {
    expect(REPORT.length).toBeGreaterThan(14_000)
  })

  test('a short message is returned unchanged', () => {
    expect(extractInstructionWindow('What is compound interest?')).toBe('What is compound interest?')
  })

  test('a long message with no explicit lead-in returns a bounded head+tail window, not the whole body', () => {
    const window = extractInstructionWindow(PLAIN_ANALYSIS_MESSAGE)
    expect(window.length).toBeLessThan(PLAIN_ANALYSIS_MESSAGE.length)
    expect(window.length).toBeLessThan(2_000)
  })

  test('the mid-document "challenge" occurrence falls outside the head+tail window for the plain-analysis message', () => {
    const window = extractInstructionWindow(PLAIN_ANALYSIS_MESSAGE)
    expect(window).not.toContain('genuine challenge for the category')
  })

  test('an explicit lead-in phrase in the instruction is preserved even though it is short', () => {
    const window = extractInstructionWindow(EXPLICIT_CHALLENGE_MESSAGE)
    expect(window).toContain("challenge the report's conclusion about pricing")
  })
})

// Builds the decision contract the same way composeCeoContext does internally, but with references
// forced to [] -- deliberately decoupling this suite from resolveConversationReferences
// (ceo-conversation-state.ts / ceo-reference-resolution.ts). That resolver has its own separate,
// pre-existing bug (it scans the whole message for bare pronouns like "this"/"it"/"that" and flags them
// ambiguous whenever there is no prior conversation to resolve against -- misfiring on almost any
// English paragraph, since those words are extremely common, independent of anything this incident is
// about). Mirrors the established pattern in tests/ceo-architecture-invariants.test.ts of passing
// references explicitly rather than always deriving them.
function classifyMessage(message: string) {
  const state = deriveCeoConversationState([], message)
  const context = buildCanonicalConversationContext({ currentMessage: message, rows: [], state, references: [] })
  return buildConversationDecisionContract(context)
}

describe('Long-document incident: classification of the exact failing turn shape', () => {
  test('a plain "deep analysis" request over a long report is classified answer/explain, never challenge, even though the document itself uses the word "challenge"', () => {
    const contract = classifyMessage(PLAIN_ANALYSIS_MESSAGE)
    expect(['answer', 'explain']).toContain(contract.responseAction)
  })

  test('an explicit "challenge this" request over the same underlying document is still correctly classified as challenge', () => {
    const contract = classifyMessage(EXPLICIT_CHALLENGE_MESSAGE)
    expect(contract.responseAction).toBe('challenge')
  })
})

describe('Long-document incident: end-to-end through composeCeoContext (clamping and structure only)', () => {
  test('the full document reaches the canonical context unclamped (under CEO_MESSAGE_CLAMP_CHARS), so the generation model still sees all of it', async () => {
    const composed = await composeCeoContext({
      systemPrompt: 'You are Agent007.',
      currentUserMessage: PLAIN_ANALYSIS_MESSAGE,
      persistedMessages: [],
      memories: [],
    })
    expect(composed.canonicalSemanticContext.currentMessage.length).toBe(PLAIN_ANALYSIS_MESSAGE.trim().length)
    expect(composed.canonicalSemanticContext.currentMessage).toContain('genuine challenge for the category')
    expect(composed.canonicalSemanticContext.currentMessage.length).toBeLessThanOrEqual(CEO_MESSAGE_CLAMP_CHARS)
  })

  test('document structure (paragraph breaks) survives into the canonical currentMessage instead of being flattened to one line', async () => {
    const composed = await composeCeoContext({
      systemPrompt: 'You are Agent007.',
      currentUserMessage: PLAIN_ANALYSIS_MESSAGE,
      persistedMessages: [],
      memories: [],
    })
    expect(composed.canonicalSemanticContext.currentMessage).toContain('\n\n')
  })
})

describe('Long-document incident: quality gate no longer confuses lexical coverage with comprehension', () => {
  test('a concise, accurate synthesis of the long report is not rejected for failing to repeat the source vocabulary', () => {
    const content = [
      'Overall, the business grew steadily this quarter: revenue and retention both held up, and onboarding friction fell after the new setup wizard.',
      'The main watch item is intensifying price competition, which leadership chose not to match directly given strong differentiation in support.',
      'Going forward, the plan favors deepening mid-market integrations over chasing new enterprise deals, since the sales-cycle risk is smaller and the near-term return looks stronger.',
      'None of the pending partnership discussions are contractually committed yet, so they remain pipeline rather than booked revenue for planning purposes.',
    ].join(' ')
    const quality = evaluateCeoQuality({ objective: PLAIN_ANALYSIS_MESSAGE, content, path: 'full', intent: 'analysis', reviewed: false, externalExecutionSucceeded: true })
    expect(quality.checks.objectiveCoverage).toBe(true)
  })

  test('a genuinely off-topic non-answer is still rejected -- the long-objective relaxation is not an unconditional bypass', () => {
    const content = 'I like turtles.'
    const quality = evaluateCeoQuality({ objective: PLAIN_ANALYSIS_MESSAGE, content, path: 'full', intent: 'analysis', reviewed: false, externalExecutionSucceeded: true })
    expect(quality.checks.objectiveCoverage).toBe(false)
  })
})
