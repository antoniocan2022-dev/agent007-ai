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
