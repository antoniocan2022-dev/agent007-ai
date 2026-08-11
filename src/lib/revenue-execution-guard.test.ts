import { describe, expect, test } from 'bun:test'
import {
  assertCompletionEvidence,
  canTransition,
  executionActionName,
  validateRevenueRequest,
} from './revenue-execution-guard'

describe('revenue execution guardrails', () => {
  test('normalizes idempotency keys and produces deterministic action names', () => {
    const request = validateRevenueRequest({
      action: 'prepare_checkout',
      idempotencyKey: '  checkout   customer-7  ',
      payload: { tier: 'standard' },
    })

    expect(request.idempotencyKey).toBe('checkout customer-7')
    expect(executionActionName(request.action, request.idempotencyKey)).toBe('revenue.prepare_checkout:checkout customer-7')
  })

  test('rejects sensitive values and oversized nested payloads', () => {
    expect(() => validateRevenueRequest({
      action: 'prepare_outreach',
      idempotencyKey: 'safe-1',
      payload: { apiKey: 'not-allowed' },
    })).toThrow('Sensitive payload field is not allowed')

    expect(() => validateRevenueRequest({
      action: 'prepare_outreach',
      idempotencyKey: 'safe-2',
      payload: { text: 'x'.repeat(9000) },
    })).toThrow('Revenue payload is too large')
  })

  test('enforces the explicit lifecycle', () => {
    expect(canTransition('pending', 'approved')).toBe(true)
    expect(canTransition('approved', 'executing')).toBe(true)
    expect(canTransition('pending', 'executing')).toBe(false)
    expect(canTransition('done', 'executing')).toBe(false)
  })

  test('requires provider evidence for verified external results', () => {
    expect(() => assertCompletionEvidence({ externalSideEffect: false, revenueVerified: true }))
      .toThrow('Revenue cannot be marked verified')

    expect(() => assertCompletionEvidence({ externalSideEffect: true, provider: 'stripe' }))
      .toThrow('Provider evidence is required')

    expect(() => assertCompletionEvidence({
      externalSideEffect: true,
      provider: 'stripe',
      providerReference: 'pi_123',
      revenueVerified: true,
    })).not.toThrow()
  })
})
