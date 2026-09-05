import { describe, expect, test } from 'bun:test'
import { isResponseSuperseded, isUniqueConstraintViolation, normalizeClientRequestId } from '@/lib/ceo-turn-sequencing'

describe('Recommendation 2: optimistic revision-sequencing and idempotency primitives', () => {
  test('a response computed against the latest turn it observed is not superseded', () => {
    expect(isResponseSuperseded(3, 3)).toBe(false)
  })

  test('a response is superseded once a newer turn has been accepted for the conversation', () => {
    expect(isResponseSuperseded(3, 4)).toBe(true)
    expect(isResponseSuperseded(1, 100)).toBe(true)
  })

  test('a revision can never move backward relative to what was captured, so a lower latest revision is never superseded', () => {
    expect(isResponseSuperseded(5, 4)).toBe(false)
  })

  test('recognizes a Prisma unique-constraint violation (P2002) as a duplicate request', () => {
    expect(isUniqueConstraintViolation({ code: 'P2002' })).toBe(true)
  })

  test('does not treat unrelated errors as duplicate requests', () => {
    expect(isUniqueConstraintViolation({ code: 'P2025' })).toBe(false)
    expect(isUniqueConstraintViolation(new Error('boom'))).toBe(false)
    expect(isUniqueConstraintViolation(null)).toBe(false)
    expect(isUniqueConstraintViolation(undefined)).toBe(false)
  })

  test('normalizes a client-supplied idempotency key, trimming whitespace and capping length', () => {
    expect(normalizeClientRequestId('  abc-123  ')).toBe('abc-123')
    expect(normalizeClientRequestId('x'.repeat(500))).toBe('x'.repeat(200))
  })

  test('treats a missing, empty, or non-string idempotency key as opting out of idempotency', () => {
    expect(normalizeClientRequestId(undefined)).toBeNull()
    expect(normalizeClientRequestId('')).toBeNull()
    expect(normalizeClientRequestId('   ')).toBeNull()
    expect(normalizeClientRequestId(42)).toBeNull()
  })
})
