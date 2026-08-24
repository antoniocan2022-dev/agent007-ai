import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'bun:test'
import { db } from '../src/lib/db'
import { resolveStripeCustomer } from '../src/lib/stripe-customer-resolution'
import { assertRealSucceededTransaction } from '../src/lib/transaction-evidence-integrity'
import { settleInvoiceFromTransaction, activateSubscriptionFromPaidInvoice } from '../src/lib/billing-lifecycle'
import { calculateOperationalKpis } from '../src/lib/operational-kpi-engine'

const userId = process.env.SEED_USER_ID?.trim() || 'ci-owner'
const ventureId = 'venture_001'
const missionId = `commercial-db-test-mission-${randomUUID()}`
const suffix = randomUUID().replace(/-/g, '')

let customerId = ''
let transactionId = ''
let invoiceId = ''
let subscriptionId = ''

describe('commercial database contract', () => {
  it('keeps the Prisma schema contract aligned with Transaction.customerId', async () => {
    const result = await db.$queryRaw<Array<{ name: string; nullable: string; dataType: string }>>`
      SELECT column_name AS name,
             is_nullable AS nullable,
             data_type AS "dataType"
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='Transaction' AND column_name='customerId'
    `
    expect(result).toEqual([{ name: 'customerId', nullable: 'YES', dataType: 'text' }])
  })

  it('verifies Transaction.customerId column, nullable contract, foreign key semantics, and exact non-unique index in the live database', async () => {
    const result = await db.$queryRaw<Array<{ columnName: string; nullable: string; dataType: string; foreignKeyName: string | null; referencedTable: string | null; onDelete: string | null; onUpdate: string | null; indexName: string; isUnique: boolean; columnNames: string[] }>>`
      SELECT c.column_name AS "columnName",
             c.is_nullable AS nullable,
             c.data_type AS "dataType",
             fk.constraint_name AS "foreignKeyName",
             fk.foreign_table_name AS "referencedTable",
             fk.delete_rule AS "onDelete",
             fk.update_rule AS "onUpdate",
             idx.indexname AS "indexName",
             ix.indisunique AS "isUnique",
             ARRAY(
               SELECT a.attname
               FROM pg_attribute a
               JOIN unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON k.attnum = a.attnum
               WHERE a.attrelid = ix.indrelid
               ORDER BY k.ord
             ) AS "columnNames"
      FROM information_schema.columns c
      LEFT JOIN LATERAL (
        SELECT tc.constraint_name, ccu.table_name AS foreign_table_name, rc.delete_rule, rc.update_rule
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
        WHERE tc.table_schema='public' AND tc.table_name='Transaction' AND tc.constraint_type='FOREIGN KEY' AND ccu.table_name='Customer' AND ccu.column_name='id'
        LIMIT 1
      ) fk ON TRUE
      LEFT JOIN pg_indexes idx ON idx.schemaname='public' AND idx.tablename='Transaction' AND idx.indexname='Transaction_customerId_idx'
      LEFT JOIN pg_class ix ON ix.relname=idx.indexname
      WHERE c.table_schema='public' AND c.table_name='Transaction' AND c.column_name='customerId'
    `
    expect(result[0]).toBeDefined()
    expect(result[0]).toMatchObject({
      columnName: 'customerId',
      nullable: 'YES',
      dataType: 'text',
      foreignKeyName: 'Transaction_customerId_fkey',
      referencedTable: 'Customer',
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
      indexName: 'Transaction_customerId_idx',
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
    const createPromise = Promise.resolve(db.transaction.create({
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
    }))
    await expect(createPromise).rejects.toThrow()
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
