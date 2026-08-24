import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { db } from '../src/lib/db'
import { ensureInitialBusinessUnits, createOrGetVenture } from '../src/lib/venture-commercial-foundation'
import { assertRealSucceededTransaction } from '../src/lib/transaction-evidence-integrity'
import { verifyTransactionCustomerSchema } from '../src/lib/verify-transaction-customer-schema'
import { resolveStripeCustomer } from '../src/lib/stripe-customer-resolution'
import { attributeMissionTransaction } from '../src/lib/mission-money-bridge'
import { settleInvoiceFromTransaction, activateSubscriptionFromPaidInvoice } from '../src/lib/billing-lifecycle'
import { calculateOperationalKpis } from '../src/lib/operational-kpi-engine'

describe('commercial database contract', () => {
  const suffix = `${Date.now()}_${randomUUID().slice(0, 8)}`
  let userId = ''
  let customerId = ''
  let ventureId = ''
  let transactionId = ''
  let invoiceId = ''
  let subscriptionId = ''
  let missionId = ''

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for commercial database integration tests.')

    const user = await db.user.create({
      data: {
        email: `ci-commercial-${suffix}@example.test`,
        passwordHash: 'ci-only-hash',
        name: 'CI Commercial Test Owner',
      },
      select: { id: true },
    })
    userId = user.id

    const customer = await db.customer.create({
      data: {
        userId,
        name: 'CI Commercial Customer',
        email: `customer-${suffix}@example.test`,
        status: 'customer',
        value: 125,
      },
      select: { id: true },
    })
    customerId = customer.id

    const units = await ensureInitialBusinessUnits(userId)
    const venture = await createOrGetVenture({
      ventureKey: `venture_ci_${suffix.replace(/[^a-z0-9]/gi, '').toLowerCase()}`,
      businessUnitId: units[0].id,
      ownerUserId: userId,
      name: 'CI Commercial Venture',
      type: 'integration-test',
      description: 'Ephemeral integration-test venture.',
      targetMarket: 'CI',
      pricingModel: 'one-time',
      status: 'ACTIVE',
      productionState: 'PRODUCTION',
    })
    ventureId = venture.id

    await db.$executeRaw`UPDATE "Customer" SET "ventureId"=${ventureId} WHERE "id"=${customerId}`

    const transaction = await db.transaction.create({
      data: {
        userId,
        provider: 'ci-test',
        providerTxId: `tx-${suffix}`,
        amount: 125,
        currency: 'USD',
        status: 'succeeded',
        customerEmail: `customer-${suffix}@example.test`,
        customerName: 'CI Commercial Customer',
        productName: 'CI Test Product',
        description: 'Real database integration transaction.',
        rawPayload: JSON.stringify({ source: 'ci', suffix }),
        ventureId,
        customerId,
      },
      select: { id: true },
    })
    transactionId = transaction.id

    subscriptionId = `sub_ci_${suffix}`
    await db.$executeRaw`
      INSERT INTO "Subscription"
        ("id","ventureId","customerId","provider","providerSubscriptionId","status","plan","amount","currency","interval")
      VALUES
        (${subscriptionId},${ventureId},${customerId},'ci-test',${subscriptionId},'past_due','CI Plan',125,'USD','month')
    `

    invoiceId = `inv_ci_${suffix}`
    await db.$executeRaw`
      INSERT INTO "Invoice"
        ("id","ventureId","customerId","subscriptionId","provider","providerInvoiceId","status","amount","currency")
      VALUES
        (${invoiceId},${ventureId},${customerId},${subscriptionId},'ci-test',${invoiceId},'open',125,'USD')
    `

    missionId = `mission_ci_${suffix}`

    const attribution = await attributeMissionTransaction({
      missionId,
      ventureId,
      transactionId,
      source: 'ci-commercial-integration',
    })
    expect(attribution.customerId).toBe(customerId)
    expect(attribution.amount).toBe(125)
  })

  afterAll(async () => {
    if (missionId) {
      const rows = await db.memory.findMany({ where: { category: 'architecture_business_outcome' }, take: 5000 })
      for (const row of rows) {
        try {
          const value = JSON.parse(row.value) as { missionId?: string }
          if (value.missionId === missionId) await db.memory.delete({ where: { key: row.key } })
        } catch {}
      }
    }
    if (invoiceId) await db.$executeRaw`DELETE FROM "Invoice" WHERE "id"=${invoiceId}`
    if (subscriptionId) await db.$executeRaw`DELETE FROM "Subscription" WHERE "id"=${subscriptionId}`
    if (transactionId) await db.transaction.delete({ where: { id: transactionId } })
    if (ventureId) await db.$executeRaw`DELETE FROM "Venture" WHERE "id"=${ventureId}`
    if (customerId) await db.customer.delete({ where: { id: customerId } })
    if (userId) await db.user.delete({ where: { id: userId } })
    await db.$disconnect()
  })

  it('keeps the Prisma schema contract aligned with Transaction.customerId', () => {
    const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
    expect(schema).toContain('customerId    String?')
    expect(schema).toContain('Customer      Customer? @relation(fields: [customerId], references: [id], onDelete: SetNull, onUpdate: Cascade)')
    expect(schema).toContain('@@index([customerId])')
  })

  it('verifies Transaction.customerId column, nullable contract, foreign key semantics, and exact non-unique index in the live database', async () => {
    const result = await verifyTransactionCustomerSchema(db)
    expect(result.column).toEqual({ name: 'customerId', dataType: 'text', isNullable: true })
    expect(result.foreignKey).toEqual({
      name: 'Transaction_customerId_fkey',
      sourceColumn: 'customerId',
      targetTable: 'Customer',
      targetColumn: 'id',
      deleteRule: 'SET NULL',
      updateRule: 'CASCADE',
    })
    expect(result.index).toEqual({
      name: 'Transaction_customerId_idx',
      isUnique: false,
      columnNames: ['customerId'],
    })
  })

  it('resolves Stripe customers idempotently within the owner scope', async () => {
    const email = `stripe-customer-${suffix}@example.test`
    const first = await resolveStripeCustomer({ userId, email, name: 'Stripe Customer' })
    const second = await resolveStripeCustomer({ userId, email: email.toUpperCase(), name: 'Stripe Customer Updated' })
    expect(first).toBeTruthy()
    expect(second).toBe(first)

    const customer = await db.customer.findUnique({ where: { id: first! }, select: { userId: true, email: true, status: true, name: true } })
    expect(customer).toEqual({ userId, email, status: 'customer', name: 'Stripe Customer Updated' })
    await db.customer.delete({ where: { id: first! } })
  })

  it('rejects an orphan Transaction.customerId at the real PostgreSQL foreign key', async () => {
    const providerTxId = `ci-customer-fk-${randomUUID()}`
    await expect(
      db.transaction.create({
        data: {
          userId,
          provider: 'ci-customer-fk',
          providerTxId,
          amount: 1,
          currency: 'USD',
          status: 'succeeded',
          rawPayload: JSON.stringify({ test: 'orphan-customer-fk' }),
          customerId: `missing-customer-${randomUUID()}`,
        },
      }),
    ).rejects.toThrow()
  })

  it('executes the real Transaction evidence query against the reconciled schema', async () => {
    const evidence = await assertRealSucceededTransaction({ ventureId, transactionId, customerId, amount: 125, currency: 'USD' })
    expect(evidence.id).toBe(transactionId)
    expect(evidence.ventureId).toBe(ventureId)
    expect(evidence.customerId).toBe(customerId)
    expect(evidence.amount).toBe(125)
    expect(evidence.currency).toBe('USD')
  })

  it('rejects transaction evidence when customer, venture scope, or amount is wrong', async () => {
    await expect(assertRealSucceededTransaction({ ventureId, transactionId, customerId: 'customer_wrong_identity' })).rejects.toThrow('customer does not match')
    await expect(assertRealSucceededTransaction({ ventureId: 'venture_wrong_scope', transactionId })).rejects.toThrow('not scoped to venture')
    await expect(assertRealSucceededTransaction({ ventureId, transactionId, amount: 99 })).rejects.toThrow('amount does not match')
  })

  it('keeps Mission → Money attribution anchored to the real transaction ledger', async () => {
    const outcomes = await db.memory.findMany({ where: { category: 'architecture_business_outcome' }, take: 5000 })
    const matching = outcomes.filter((row) => {
      try {
        const value = JSON.parse(row.value) as { missionId?: string; transactionId?: string; customerId?: string }
        return value.missionId === missionId && value.transactionId === transactionId && value.customerId === customerId
      } catch {
        return false
      }
    })
    expect(matching.length).toBeGreaterThanOrEqual(2)
  })

  it('settles an invoice only from the matching succeeded transaction and activates the subscription', async () => {
    const result = await settleInvoiceFromTransaction(invoiceId, transactionId)
    expect(result.status).toBe('paid')
    expect(result.transactionId).toBe(transactionId)

    await activateSubscriptionFromPaidInvoice(subscriptionId, new Date(Date.now() + 60_000).toISOString(), new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString())

    const subscription = await db.$queryRaw<Array<{ status: string; cancelAtPeriodEnd: boolean }>>`
      SELECT "status","cancelAtPeriodEnd" FROM "Subscription" WHERE "id"=${subscriptionId}
    `
    expect(subscription[0]?.status).toBe('active')
    expect(subscription[0]?.cancelAtPeriodEnd).toBe(false)
  })

  it('reconciles KPI revenue to the real transaction rather than synthetic outcome values', async () => {
    const snapshot = await calculateOperationalKpis(ventureId, 24)
    expect(snapshot.outcomes.transactions).toBe(1)
    expect(snapshot.outcomes.grossRevenue).toBe(125)
    expect(snapshot.outcomes.netRevenue).toBe(125)
    expect(snapshot.outcomes.currency).toBe('USD')
    expect(snapshot.controlHealth.syntheticRevenueDetected).toBe(false)
    expect(snapshot.relationalCommercial?.transactions).toBe(1)
    expect(snapshot.relationalCommercial?.grossTransactionRevenue).toBe(125)
  })
})
