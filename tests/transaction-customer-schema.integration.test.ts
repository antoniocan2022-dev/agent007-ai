import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { verifyTransactionCustomerSchema } from '../src/lib/verify-transaction-customer-schema'

const db = new PrismaClient()

describe('Transaction.customerId database contract', () => {
  beforeAll(() => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for Transaction.customerId integration tests.')
  })

  afterAll(async () => {
    await db.$disconnect()
  })

  it('verifies the column, nullable contract, foreign key semantics, and exact non-unique index', async () => {
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

  it('rejects an orphan Transaction.customerId at the real PostgreSQL foreign key', async () => {
    const providerTxId = `ci-customer-fk-${randomUUID()}`

    await expect(
      db.transaction.create({
        data: {
          userId: `ci-user-${randomUUID()}`,
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
})
