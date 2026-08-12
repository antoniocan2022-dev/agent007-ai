import { afterEach, describe, expect, test } from 'bun:test'
import { clearOutcomeIntelligenceForTests, getOutcomeSnapshot, recordModelOutcome, recommendByVerifiedOutcome } from './outcome-intelligence'

describe('Outcome Intelligence', () => {
  afterEach(() => clearOutcomeIntelligenceForTests())

  test('does not confuse provider success with verified business outcome', () => {
    recordModelOutcome({ provider: 'groq', model: 'llama-3.3-70b-versatile', taskType: 'financial', status: 'failed', qualityScore: 20, businessValueScore: 10, verificationPassed: false })
    const snapshot = getOutcomeSnapshot('groq', 'llama-3.3-70b-versatile', 'financial')
    expect(snapshot.failures).toBe(1)
    expect(snapshot.outcomeScore).toBeLessThan(50)
  })

  test('rewards verified quality and business value', () => {
    for (let i = 0; i < 4; i++) {
      recordModelOutcome({ provider: 'openai', model: 'gpt-5', taskType: 'financial', status: 'verified_success', qualityScore: 96, businessValueScore: 94, verificationPassed: true })
    }
    const snapshot = getOutcomeSnapshot('openai', 'gpt-5', 'financial')
    expect(snapshot.outcomeScore).toBeGreaterThanOrEqual(90)
    expect(snapshot.confidence).toBeGreaterThan(40)
    expect(snapshot.verificationRate).toBe(100)
  })

  test('keeps recommendation ordering based on outcome evidence only', () => {
    recordModelOutcome({ provider: 'groq', model: 'llama-3.3-70b-versatile', taskType: 'coding', status: 'partial', qualityScore: 70, businessValueScore: 60, verificationPassed: true })
    recordModelOutcome({ provider: 'mistral', model: 'mistral-large-latest', taskType: 'coding', status: 'verified_success', qualityScore: 96, businessValueScore: 95, verificationPassed: true })
    const ranked = recommendByVerifiedOutcome('coding', [
      { provider: 'groq', model: 'llama-3.3-70b-versatile' },
      { provider: 'mistral', model: 'mistral-large-latest' },
    ])
    expect(ranked[0]?.provider).toBe('mistral')
  })

  test('clamps invalid scores rather than allowing score poisoning', () => {
    recordModelOutcome({ provider: 'zai', model: 'glm-5.1', taskType: 'research', status: 'partial', qualityScore: 999, businessValueScore: -100, verificationPassed: false })
    const snapshot = getOutcomeSnapshot('zai', 'glm-5.1', 'research')
    expect(snapshot.avgQualityScore).toBe(100)
    expect(snapshot.avgBusinessValueScore).toBe(0)
    expect(snapshot.outcomeScore).toBeGreaterThanOrEqual(0)
    expect(snapshot.outcomeScore).toBeLessThanOrEqual(100)
  })
})
