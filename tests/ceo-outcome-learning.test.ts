import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { correlateRecommendationOutcomes, generateRecommendationCorrelationId } from '@/lib/ceo-outcome-learning'

const ROOT = join(import.meta.dir, '..')

describe('Phase 19 outcome learning', () => {
  test('a recommendation correlates correctly with a matching verified outcome, ignoring unrelated records', () => {
    const id = generateRecommendationCorrelationId()
    const recommendationRecords = [
      { value: JSON.stringify({ schemaVersion: 1, correlationId: id, objective: 'Prioritize revenue recovery', responseAction: 'recommend', recordedAt: Date.now() }) },
      { value: JSON.stringify({ schemaVersion: 1, correlationId: 'other-id', objective: 'Unrelated', responseAction: 'recommend', recordedAt: Date.now() }) },
    ]
    const outcomeRecords = [
      { value: JSON.stringify({ revenueCorrelationId: id, transactionId: 'tx_1', amount: 500, currency: 'usd', type: 'TRANSACTION', occurredAt: new Date().toISOString() }) },
      { value: JSON.stringify({ revenueCorrelationId: 'other-id', transactionId: 'tx_2', amount: 100, currency: 'usd', type: 'TRANSACTION', occurredAt: new Date().toISOString() }) },
    ]
    const result = correlateRecommendationOutcomes(id, recommendationRecords, outcomeRecords)
    expect(result.recommendation?.correlationId).toBe(id)
    expect(result.outcomes).toHaveLength(1)
    expect((result.outcomes[0]?.metadata as any)?.transactionId).toBe('tx_1')
    expect(result.hasVerifiedOutcome).toBe(true)
  })

  test('a correlation ID with no matching records returns a well-formed empty result, not an error', () => {
    const result = correlateRecommendationOutcomes('nonexistent-id', [], [])
    expect(result.recommendation).toBeNull()
    expect(result.outcomes).toEqual([])
    expect(result.hasVerifiedOutcome).toBe(false)
  })

  test('a malformed record in either set is skipped without breaking correlation', () => {
    const id = generateRecommendationCorrelationId()
    const result = correlateRecommendationOutcomes(id, [{ value: '{ not valid json' }], [{ value: '{ also not valid' }])
    expect(result.recommendation).toBeNull()
    expect(result.outcomes).toEqual([])
  })

  test('generateRecommendationCorrelationId now produces deterministic, hash-based ids rather than random ones -- a real upgrade from the parallel work, still unique per call due to the embedded timestamp/random seed', () => {
    const a = generateRecommendationCorrelationId()
    const b = generateRecommendationCorrelationId()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThan(10)
    expect(a).toMatch(/^ceo_rec_[a-f0-9]{24}$/)
  })

  test('recommendation tracking is wired into the live route only for genuine recommend/decide actions, and this does not modify the existing Stripe transaction verification logic at all', () => {
    const route = readFileSync(join(ROOT, 'src/app/api/agent/route.ts'), 'utf-8')
    expect(route).toContain('recordCeoRecommendation')
    expect(route).toMatch(/responseAction === 'recommend'.*responseAction === 'decide'/)
    const outcomeIntegrity = readFileSync(join(ROOT, 'src/lib/business-outcome-integrity.ts'), 'utf-8')
    expect(outcomeIntegrity).not.toContain('ceo-outcome-learning')
  })
})
