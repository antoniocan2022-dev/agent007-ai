import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { recordVerifiedTransactionOutcome } from '@/lib/business-outcome-integrity'
import { assertStripeReplayCompatible, nextStripeTransactionState } from '@/lib/stripe-webhook-integrity'

describe('Stripe economic idempotency', () => {
  let userId = ''
  let businessUnitId = ''
  let ventureId = ''
  let customerId = ''
  let transactionId = ''
  const providerTxId = `stripe-proof-${randomUUID()}`

  beforeAll(async () => {
    userId = randomUUID()
    businessUnitId = `bu_${randomUUID()}`
    ventureId = `venture_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    customerId = `cust_${randomUUID()}`
    const email = `stripe-idempotency-${randomUUID()}@example.test`
    await db.user.create({ data: { id: userId, email, name: 'Stripe Economic Idempotency Test' } })
    await db.businessUnit.create({ data: { id: businessUnitId, key: `idempotency_${randomUUID().slice(0, 8)}`, name: 'Idempotency Test Business', ownerUserId: userId } })
    await db.venture.create({ data: { id: ventureId, slug: `idempotency-${randomUUID().slice(0, 8)}`, name: 'Idempotency Test Venture', businessUnitId, ownerUserId: userId, lifecycleStatus: 'ACTIVE' as any } })
    await db.customer.create({ data: { id: customerId, userId, ventureId, email, name: 'Stripe Idempotency Customer' } })
    const tx = await db.transaction.create({ data: { userId, provider: 'stripe', providerTxId, amount: 1, currency: 'USD', status: 'succeeded', customerId, ventureId, customerEmail: email } })
    transactionId = tx.id
  })

  afterAll(async () => {
    await db.memory.deleteMany({ where: { key: { startsWith: `architecture_business_outcome:TRANSACTION:${transactionId}` } } }).catch(() => {})
    await db.transaction.deleteMany({ where: { id: transactionId } }).catch(() => {})
    await db.customer.deleteMany({ where: { id: customerId } }).catch(() => {})
    await db.venture.deleteMany({ where: { id: ventureId } }).catch(() => {})
    await db.businessUnit.deleteMany({ where: { id: businessUnitId } }).catch(() => {})
    await db.user.deleteMany({ where: { id: userId } }).catch(() => {})
    await db.$disconnect()
  })

  test('same provider event cannot drift economic identity', async () => {
    const existing = await db.transaction.findUniqueOrThrow({ where: { id: transactionId } })
    expect(() => assertStripeReplayCompatible(existing, { userId, status: 'succeeded', amount: 1, currency: 'USD', customerId, ventureId })).not.toThrow()
    expect(() => assertStripeReplayCompatible(existing, { userId, status: 'succeeded', amount: 2, currency: 'USD', customerId, ventureId })).toThrow('amount mismatch')
  })

  test('duplicate outcome processing remains one canonical evidence record', async () => {
    await recordVerifiedTransactionOutcome({ ventureId, transactionId, amount: 1, currency: 'USD' })
    await recordVerifiedTransactionOutcome({ ventureId, transactionId, amount: 1, currency: 'USD' })
    const rows = await db.memory.findMany({ where: { key: `architecture_business_outcome:TRANSACTION:${transactionId}` } })
    expect(rows).toHaveLength(1)
  })

  test('partial-processing recovery can complete from an already-persisted transaction', async () => {
    await db.memory.deleteMany({ where: { key: `architecture_business_outcome:TRANSACTION:${transactionId}` } })
    const existing = await db.transaction.findUniqueOrThrow({ where: { id: transactionId } })
    expect(existing.status).toBe('succeeded')
    await recordVerifiedTransactionOutcome({ ventureId, transactionId, amount: 1, currency: 'USD' })
    const outcome = await db.memory.findUnique({ where: { key: `architecture_business_outcome:TRANSACTION:${transactionId}` } })
    expect(outcome?.category).toBe('architecture_business_outcome')
  })

  test('late success replay cannot undo a verified refund state', () => {
    expect(nextStripeTransactionState('refunded', 'succeeded')).toBe('refunded')
  })
})
