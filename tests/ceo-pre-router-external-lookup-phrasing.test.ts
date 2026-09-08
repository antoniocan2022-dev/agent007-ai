import { describe, expect, test } from 'bun:test'
import { preRouteCeoRequest } from '@/lib/ceo-pre-router'

// Item 2 of the "make Agent007 feel like Claude" plan: pre-router's research-intent trigger only
// matched research|search|look up|find out|verify|validate literally, so common natural phrasings
// for the same request ("can you check online for X", "what's the latest on Y") silently fell
// through to plain conversation and never triggered evidence acquisition at all. Widened with
// specific phrases, not bare generic verbs -- "check"/"confirm"/"look into" alone are used
// constantly for purely internal requests and must not be misrouted into an unnecessary
// external-evidence requirement.

const user = (content: string) => [{ role: 'user' as const, content }]

describe('CEO pre-router: natural external-lookup phrasing now routes to research intent', () => {
  const shouldRouteToResearch = [
    'Can you check online for the latest CAC benchmarks in our industry?',
    "What's the latest news on our main competitor?",
    'Google this for me: best CRM for a 10-person sales team.',
    'Can you fact check this claim before we use it in the deck?',
    'What is the current price of Bitcoin?',
    'Look this up online: is remote work still trending down?',
  ]
  for (const message of shouldRouteToResearch) {
    test(`"${message}" routes to research intent with external evidence required`, () => {
      const decision = preRouteCeoRequest(user(message))
      expect(decision.executionContract.intent).toBe('research')
      expect(decision.executionContract.evidenceClass).toBe('external_web')
      expect(decision.executionContract.toolRequired).toBe(true)
    })
  }
})

describe('CEO pre-router: bare generic verbs in purely internal requests are NOT misrouted to research', () => {
  const shouldStayInternal = [
    'Can you check the budget before we approve this?',
    'Confirm the meeting is still at 3pm.',
    'What was our Google Ads spend last month?',
    'Double check the numbers in the report.',
  ]
  for (const message of shouldStayInternal) {
    test(`"${message}" does not route to research intent`, () => {
      const decision = preRouteCeoRequest(user(message))
      expect(decision.executionContract.intent).not.toBe('research')
    })
  }
})

// Deep-audit fix: EXTERNAL_LOOKUP_PHRASE_RE's original "current (price|news|status) of" alternative
// false-positived on ordinary internal status/pricing questions -- verified directly, all 5 of these
// previously routed to intent:'research', evidenceClass:'external_web', toolRequired:true, meaning the
// CEO would attempt a live web search to answer a question about its own internal state. "status" was
// dropped entirely (it skews internal far more than "price"/"news" in a business-CEO context and had
// zero existing test coverage requiring it); "price"/"news" now exclude "of our/my/internal X".
describe('CEO pre-router: internal status/pricing questions are NOT misrouted to external research', () => {
  const shouldStayInternal = [
    'What is the current status of the deployment?',
    'What is the current status of the mission?',
    'Give me the current status of the revenue pipeline.',
    'What is the current status of our onboarding project?',
    'What is the current price of our subscription plan?',
  ]
  for (const message of shouldStayInternal) {
    test(`"${message}" does not route to research intent`, () => {
      const decision = preRouteCeoRequest(user(message))
      expect(decision.executionContract.intent).not.toBe('research')
      expect(decision.executionContract.evidenceClass).not.toBe('external_web')
    })
  }
})

// Deep-audit fix (found via independent adversarial review, then confirmed directly): bare "check
// online" matched "check online banking for the wire transfer status" and "check online to see if the
// invoice cleared" -- both about the user's own accounts, misrouted to external web research. "check
// online" now requires "...for" immediately after, matching a genuine web-search directive.
describe('CEO pre-router: "check online" about the user\'s own accounts is NOT misrouted to external research', () => {
  const shouldStayInternal = [
    'Check online banking for the wire transfer status.',
    'Check online to see if the invoice cleared.',
  ]
  for (const message of shouldStayInternal) {
    test(`"${message}" does not route to research intent`, () => {
      const decision = preRouteCeoRequest(user(message))
      expect(decision.executionContract.intent).not.toBe('research')
      expect(decision.executionContract.evidenceClass).not.toBe('external_web')
    })
  }
})
