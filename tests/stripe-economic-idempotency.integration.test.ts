import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { recordVerifiedTransactionOutcome } from '@/lib/business-outcome-integrity'
import { assertStripeReplayCompatible, nextStripeTransactionState } from '@/lib/stripe-webhook-integrity'
import { createOrGetVenture } from '@/lib/venture-commercial-foundation'

describe('Stripe economic idempotency', () => {
  let userId = ''
  let customerId = ''
  let transactionId = ''
  let relationalVentureId = ''
  const providerTxId = `stripe-proof-${randomUUID()}`
  const ventureKey = `stripe_idempotency_${randomUUID().replace(/-/g, '').slice(0, 12)}`

  beforeAll(async () => {
    userId = randomUUID()
    customerId = `cust_${randomUUID()}`
    const email = `stripe-idempotency-${randomUUID()}@example.test`
    await db.user.create({ data: { id: userId, email, passwordHash: 'ci-test-password-hash', name: 'Stripe Economic Idempotency Test' } })
    const venture = await createOrGetVenture({
      ventureKey,
      businessUnitId: null,
      ownerUserId: userId,
      name: 'Stripe Idempotency Test Venture',
      type: 'test',
      description: 'Isolated integration-test venture for economic idempotency certification.',
      targetMarket: 'CI',
      pricingModel: 'test-only',
      status: 'PROPOSED',
      productionState: 'STRUCTURAL_ONLY',
    })
    relationalVentureId = venture.id
    await db.customer.create({ data: { id: customerId, userId, email, name: 'Stripe Idempotency Customer' } })
    const tx = await db.transaction.create({
      data: {
        userId,
        provider: 'stripe',
        providerTxId,
        amount: 1,
        currency: 'USD',
        status: 'succeeded',
        customerId,
        ventureId: relationalVentureId,
        customerEmail: email,
        rawPayload: JSON.stringify({ id: providerTxId, type: 'test.payment_succeeded' }),
      },
    })
    transactionId = tx.id
  })

  afterAll(async () => {
    await db.memory.deleteMany({ where: { key: { startsWith: `architecture_business_outcome:TRANSACTION:${transactionId}` } } }).catch(() => {})
    await db.transaction.deleteMany({ where: { id: transactionId } }).catch(() => {})
    await db.customer.deleteMany({ where: { id: customerId } }).catch(() => {})
    await db.$executeRaw`DELETE FROM "Venture" WHERE "id"=${relationalVentureId}`.catch(() => {})
    await db.user.deleteMany({ where: { id: userId } }).catch(() => {})
    await db.$disconnect()
  })

  test('same provider event cannot drift economic identity', async () => {
    const existing = await db.transaction.findUniqueOrThrow({ where: { id: transactionId } })
    expect(() => assertStripeReplayCompatible(existing, { userId, status: 'succeeded', amount: 1, currency: 'USD', customerId, ventureId: relationalVentureId })).not.toThrow()
    expect(() => assertStripeReplayCompatible(existing, { userId, status: 'succeeded', amount: 2, currency: 'USD', customerId, ventureId: relationalVentureId })).toThrow('amount mismatch')
  })

  test('duplicate outcome processing remains one canonical evidence record', async () => {
    await recordVerifiedTransactionOutcome({ ventureId: relationalVentureId, transactionId, amount: 1, currency: 'USD' })
    await recordVerifiedTransactionOutcome({ ventureId: relationalVentureId, transactionId, amount: 1, currency: 'USD' })
    const rows = await db.memory.findMany({ where: { key: `architecture_business_outcome:TRANSACTION:${transactionId}` } })
    expect(rows).toHaveLength(1)
  })

  test('partial-processing recovery can complete from an already-persisted transaction', async () => {
    await db.memory.deleteMany({ where: { key: `architecture_business_outcome:TRANSACTION:${transactionId}` } })
    const existing = await db.transaction.findUniqueOrThrow({ where: { id: transactionId } })
    expect(existing.status).toBe('succeeded')
    await recordVerifiedTransactionOutcome({ ventureId: relationalVentureId, transactionId, amount: 1, currency: 'USD' })
    const outcome = await db.memory.findUnique({ where: { key: `architecture_business_outcome:TRANSACTION:${transactionId}` } })
    expect(outcome?.category).toBe('architecture_business_outcome')
  })

  test('late success replay cannot undo a verified refund state', () => {
    expect(nextStripeTransactionState('refunded', 'succeeded')).toBe('refunded')
  })
})
