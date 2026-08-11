import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { db } from '@/lib/db'
import {
  approveRevenueApproval,
  claimRevenueApproval,
  completeRevenueApproval,
  prepareRevenueApproval,
} from './revenue-approval'

describe('revenue approval queue integration', () => {
  let userId = ''

  beforeAll(async () => {
    const user = await db.user.create({
      data: {
        email: `revenue-guard-${crypto.randomUUID()}@ci.example`,
        passwordHash: 'ci-test-only',
      },
    })
    userId = user.id
  })

  afterAll(async () => {
    if (userId) {
      await db.auditLog.deleteMany({ where: { userId } })
      await db.pendingManageAction.deleteMany({ where: { userId } })
      await db.user.delete({ where: { id: userId } })
    }
    await db.$disconnect()
  })

  test('deduplicates concurrent prepare requests for the same idempotency key', async () => {
    const request = {
      action: 'prepare_checkout' as const,
      idempotencyKey: 'concurrent-checkout-1',
      payload: { plan: 'standard' },
    }

    const [a, b] = await Promise.all([
      prepareRevenueApproval(userId, request),
      prepareRevenueApproval(userId, request),
    ])

    expect(a.id).toBe(b.id)
    expect(a.status).toBe('pending')

    const rows = await db.pendingManageAction.findMany({ where: { userId, action: a.action } })
    expect(rows).toHaveLength(1)
  })

  test('requires approval before claim and prevents a second claim', async () => {
    const prepared = await prepareRevenueApproval(userId, {
      action: 'prepare_fulfillment',
      idempotencyKey: 'claim-order-1',
    })

    await expect(claimRevenueApproval(userId, prepared.id)).rejects.toThrow('only approved actions can be claimed')

    await approveRevenueApproval(userId, prepared.id)
    const claimed = await claimRevenueApproval(userId, prepared.id)
    expect(claimed.status).toBe('executing')

    await expect(claimRevenueApproval(userId, prepared.id)).rejects.toThrow('only approved actions can be claimed')
  })

  test('requires provider evidence when execution reports an external side effect', async () => {
    const prepared = await prepareRevenueApproval(userId, {
      action: 'prepare_checkout',
      idempotencyKey: 'evidence-order-1',
    })
    await approveRevenueApproval(userId, prepared.id)
    await claimRevenueApproval(userId, prepared.id)

    await expect(completeRevenueApproval(userId, prepared.id, {
      externalSideEffect: true,
      revenueVerified: true,
    })).rejects.toThrow('Provider evidence is required')

    const completed = await completeRevenueApproval(userId, prepared.id, {
      externalSideEffect: true,
      provider: 'stripe',
      providerReference: 'pi_ci_123',
      revenueVerified: true,
      result: { verified: true },
    })
    expect(completed.status).toBe('done')
  })
})
