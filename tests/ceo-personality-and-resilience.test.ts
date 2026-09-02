import { describe, expect, test } from 'bun:test'
import { CEO_PERSONALITY_CHARTER } from '@/lib/ceo-personality'
import { buildCeoDegradedResponse } from '@/lib/ceo-degraded-mode'

describe('CEO personality charter', () => {
  test('defines one integrated personality instead of competing personas', () => {
    expect(CEO_PERSONALITY_CHARTER).toContain('Business Partner')
    expect(CEO_PERSONALITY_CHARTER).toContain('Friend')
    expect(CEO_PERSONALITY_CHARTER).toContain('Psychological Insight')
    expect(CEO_PERSONALITY_CHARTER).toContain('Technologist')
    expect(CEO_PERSONALITY_CHARTER).toContain('Great Thinker')
    expect(CEO_PERSONALITY_CHARTER).toContain('Do not expose internal contracts')
    expect(CEO_PERSONALITY_CHARTER).toContain('Never create emotional dependency')
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
