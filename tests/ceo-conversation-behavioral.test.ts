import { describe, expect, test } from 'bun:test'
import { deriveCeoConversationState, resolveConversationReferences } from '@/lib/ceo-conversation-state'
import { buildCanonicalConversationContext } from '@/lib/ceo-cognitive-conversation'
import { buildConversationDecisionContract } from '@/lib/ceo-conversation-decision-contract'
import { buildCeoDecisionPlan } from '@/lib/ceo-cognitive-kernel'
import { preRouteCeoRequest } from '@/lib/ceo-pre-router'
import { composeCeoResponse } from '@/lib/ceo-response-composer'
import { CEO_CONVERSATION_BEHAVIORAL_CORPUS } from './fixtures/ceo-conversation-behavioral-corpus'

describe('CEO behavioral conversation regression corpus', () => {
  test('corpus has broad behavioral coverage', () => {
    const categories = new Set(CEO_CONVERSATION_BEHAVIORAL_CORPUS.map((item) => item.category))
    expect(categories.size).toBe(10)
  })

  for (const testCase of CEO_CONVERSATION_BEHAVIORAL_CORPUS) {
    test(testCase.name, () => {
      const rows = [
        { role: 'user' as const, content: 'We are building Agent007 into a strong executive partner.', createdAt: 1 },
        { role: 'assistant' as const, content: 'The next priority is stronger conversation quality.', createdAt: 2 },
      ]
      const state = deriveCeoConversationState(rows, testCase.message)
      const references = resolveConversationReferences(testCase.message, rows, state)
      const context = buildCanonicalConversationContext({ currentMessage: testCase.message, rows, state, references })
      const contract = buildConversationDecisionContract(context)

      expect(contract.completeness).toBe(testCase.expected.completeness)
      expect(contract.responseRegister).toBe(testCase.expected.responseRegister)
      expect(contract.clarificationRequired).toBe(testCase.expected.clarificationRequired)
      expect(contract.intent).toBe(testCase.expected.intent)
      expect(contract.meaning.startsWith(testCase.message.trim())).toBe(true)
    })
  }

  test('conversation quality failures have one bounded repair attempt on the fast path', () => {
    const messages = [{ role: 'user' as const, content: 'Tell me what you think about our direction.' }]
    const preRoute = preRouteCeoRequest(messages)
    const plan = buildCeoDecisionPlan({ messages, preRoute })
    expect(plan.path).toBe('fast')
    expect(plan.maxEscalations).toBe(1)
  })

  test('self-assessment response composition keeps internal state labels private by default', () => {
    const result = composeCeoResponse({
      content: 'I am ready to lead the organization, with clear areas that still need proof.',
      evidenceState: 'PARTIAL_UNCONFIRMED',
      quality: {
        decision: 'DEGRADED',
        evidenceState: 'PARTIAL_UNCONFIRMED',
        verificationStatus: 'NOT_PERFORMED',
        checks: { nonEmpty: true, contractValid: true, objectiveCoverage: true, internalConsistency: true, evidenceDiscipline: true, actionableStructure: true },
        reasons: ['governance status'],
      },
      degraded: true,
    })
    expect(result).not.toContain('Evidence state:')
    expect(result).not.toContain('Quality gate:')
    expect(result).toContain('I am ready to lead')
  })
})
