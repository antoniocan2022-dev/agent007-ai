import { describe, expect, test } from 'bun:test'
import { isUniqueConstraintViolation, normalizeClientRequestId } from '@/lib/ceo-turn-sequencing'

describe('Recommendation 2: optimistic revision-sequencing and idempotency primitives', () => {
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
