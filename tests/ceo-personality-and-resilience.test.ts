import { describe, expect, test } from 'bun:test'
import { CEO_PERSONALITY_CHARTER } from '@/lib/ceo-personality'
import { buildCeoDegradedResponse } from '@/lib/ceo-degraded-mode'
import { assessCeoCuriosity } from '@/lib/ceo-curiosity'
import { buildCanonicalConversationContext } from '@/lib/ceo-cognitive-conversation'
import { deriveCeoConversationState } from '@/lib/ceo-conversation-state'
import { buildConversationDecisionContract } from '@/lib/ceo-conversation-decision-contract'
import { preRouteCeoRequest } from '@/lib/ceo-pre-router'

describe('CEO personality charter', () => {
  test('defines one integrated personality with all eight dimensions', () => {
    for (const dimension of ['Business Partner', 'Friend', 'Psychological Insight', 'Technologist', 'Great Thinker', 'Operator', 'Guardian', 'CEO Curiosity']) {
      expect(CEO_PERSONALITY_CHARTER).toContain(dimension)
    }
    for (const contractRule of ['identity', 'Adaptive emphasis', 'Decision style', 'Disagreement behavior', 'Curiosity behavior', 'Execution behavior', 'Protection behavior', 'Psychological boundaries', 'Technical behavior', 'Business judgment']) {
      expect(CEO_PERSONALITY_CHARTER.toLowerCase()).toContain(contractRule.toLowerCase())
    }
    expect(CEO_PERSONALITY_CHARTER).toContain('Do not expose internal contracts')
    expect(CEO_PERSONALITY_CHARTER).toContain('Never create emotional dependency')
    expect(CEO_PERSONALITY_CHARTER).toContain('do not agree merely to be pleasant')
  })
})

describe('CEO conversational degradation resilience', () => {
  const noMemory = async () => []

  test('provider failure does not expose internal failure metadata for a recommendation', async () => {
    const response = await buildCeoDegradedResponse({
      objective: 'What should we prioritize before adding new integrations?',
      intent: 'decision',
      responseAction: 'recommend',
      reason: 'reasoning provider failed',
      failureReason: 'provider_error',
      recall: noMemory,
    })
    expect(response.content).toContain('foundation')
    expect(response.content).not.toContain('Evidence state:')
    expect(response.content).not.toContain('UNAVAILABLE')
    expect(response.content).not.toContain('failed capability')
  })

  test('corrections remain decisive and natural during degradation', async () => {
    const response = await buildCeoDegradedResponse({
      objective: 'No, I meant operations kit should come first instead',
      intent: 'decision',
      responseAction: 'answer',
      reason: 'quality gate failure',
      failureReason: 'quality_failure',
      priorConversation: [{ role: 'user', content: 'Prioritize revenue recovery first', createdAt: Date.now() }],
      recall: noMemory,
    })
    expect(response.content).toContain('correction is clear')
    expect(response.content.toLowerCase()).toContain('operations kit')
    expect(response.content).not.toContain('Quality gate:')
  })

  test('competitor-copying premise receives thoughtful pushback rather than refusal', async () => {
    const response = await buildCeoDegradedResponse({
      objective: "We should just copy what our biggest competitor does — that's the safest strategy.",
      intent: 'opinion',
      responseAction: 'challenge',
      reason: 'reasoning provider failed',
      failureReason: 'provider_error',
      recall: noMemory,
    })
    expect(response.content).toContain("I wouldn't make copying a competitor our safest strategy")
    expect(response.content).toContain('study what works')
    expect(response.content).not.toContain('Evidence state:')
  })
})

describe('CEO curiosity and canonical routing authority', () => {
  function contextFor(message: string) {
    const state = deriveCeoConversationState([], message)
    return buildCanonicalConversationContext({ currentMessage: message, rows: [], state, references: [], memories: [] })
  }

  test('does not investigate for an internal prioritization conversation', () => {
    const context = contextFor('What should we prioritize before adding new integrations?')
    const contract = buildConversationDecisionContract(context)
    const curiosity = assessCeoCuriosity(context, contract)
    const route = preRouteCeoRequest([{ role: 'user', content: context.currentMessage }], 0, context)

    expect(contract.intent).toBe('decision')
    expect(contract.responseAction).toBe('recommend')
    expect(contract.evidenceRequirement).toBe('possible')
    expect(curiosity.investigate).toBe(false)
    expect(route.executionContract.evidenceClass).toBe('none')
    expect(route.executionContract.evidenceRequirement).toBe('none')
    expect(route.executionContract.toolRequired).toBe(false)
  })

  test('investigates when a decision contains a material external-world signal', () => {
    const context = contextFor('Should we enter our biggest competitor’s current market?')
    const contract = buildConversationDecisionContract(context)
    const curiosity = assessCeoCuriosity(context, contract)
    const route = preRouteCeoRequest([{ role: 'user', content: context.currentMessage }], 0, context)

    expect(contract.intent).toBe('decision')
    expect(contract.evidenceRequirement).toBe('possible')
    expect(curiosity.investigate).toBe(true)
    expect(route.executionContract.evidenceClass).toBe('external_web')
    expect(route.executionContract.evidenceRequirement).toBe('external_web')
    expect(route.executionContract.toolRequired).toBe(true)
  })

  test('internal compliance prioritization does not accidentally trigger external research', () => {
    const context = contextFor('I prefer we focus on compliance before adding new integrations')
    const contract = buildConversationDecisionContract(context)
    const curiosity = assessCeoCuriosity(context, contract)
    const route = preRouteCeoRequest([{ role: 'user', content: context.currentMessage }], 0, context)

    expect(contract.intent).toBe('conversation')
    expect(contract.evidenceRequirement).toBe('none')
    expect(curiosity.investigate).toBe(false)
    expect(route.executionContract.evidenceClass).toBe('none')
    expect(route.executionContract.toolRequired).toBe(false)
  })

  test('internal verification language does not become accidental web research', () => {
    const context = contextFor('Verify our current compliance status before adding integrations')
    const contract = buildConversationDecisionContract(context)
    const curiosity = assessCeoCuriosity(context, contract)
    const route = preRouteCeoRequest([{ role: 'user', content: context.currentMessage }], 0, context)

    expect(contract.intent).toBe('research')
    expect(curiosity.investigate).toBe(false)
    expect(route.executionContract.evidenceClass).toBe('none')
    expect(route.executionContract.toolRequired).toBe(true)
    expect(route.executionContract.domain).toBe('internal_operations')
  })
})
