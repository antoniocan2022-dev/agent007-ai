import { afterAll, describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { persistEvidenceLedger, recordExecutionReceipt, verifyEvidenceLedger } from '@/lib/proof-ledger'

const databaseConfigured = Boolean(process.env.DATABASE_URL?.trim())
const missionId = `proof-ci-${randomUUID()}`

describe.skipIf(!databaseConfigured)('proof ledger database integration', () => {
  afterAll(async () => {
    await db.executionReceipt.deleteMany({ where: { missionId } })
    await db.evidenceLedger.deleteMany({ where: { missionId } })
    await db.$disconnect()
  })

  it('persists execution receipts idempotently', async () => {
    const input = {
      missionId,
      actorId: 'SCOUT',
      actorType: 'specialist',
      action: 'research.fetch',
      status: 'SUCCESS',
      idempotencyKey: 'research-fetch-001',
      requestHash: 'request-hash-001',
      outputReference: 'evidence://raw/001',
    }

    const first = await recordExecutionReceipt(input)
    const second = await recordExecutionReceipt(input)

    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.receipt.id).toBe(first.receipt.id)

    const rows = await db.executionReceipt.count({ where: { missionId, idempotencyKey: input.idempotencyKey } })
    expect(rows).toBe(1)
    expect(first.receipt.recordHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('persists evidence provenance atomically and verifies its hash', async () => {
    const rawEvidence = {
      provider: 'test-provider',
      retrievedAt: '2026-08-19T23:00:00.000Z',
      result: { count: 1187 },
    }
    const input = {
      missionId,
      title: 'Proof integration ledger',
      idempotencyKey: 'ledger-v1',
      sources: [{
        provider: 'test-provider',
        sourceUrl: 'https://example.test/research/1187',
        rawEvidenceRef: 'test://raw/1187',
        rawEvidence,
      }],
      claims: [{
        claimKey: 'restaurant-count',
        claimText: 'The test provider reported 1187 restaurants.',
        classification: 'FACT' as const,
        confidence: 0.98,
        verificationStatus: 'VERIFIED' as const,
        sourceIndex: 0,
      }],
    }

    const first = await persistEvidenceLedger(input)
    const second = await persistEvidenceLedger(input)

    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.ledger.id).toBe(first.ledger.id)
    expect(first.ledger.version).toBe(1)
    expect(first.ledger.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(first.ledger.Source).toHaveLength(1)
    expect(first.ledger.Claim).toHaveLength(1)
    expect(first.ledger.Source[0]?.rawEvidenceHash).toMatch(/^[a-f0-9]{64}$/)

    const verification = await verifyEvidenceLedger(first.ledger.id)
    expect(verification.valid).toBe(true)
    expect(verification.actualHash).toBe(verification.expectedHash)
    expect(verification.sourceCount).toBe(1)
    expect(verification.claimCount).toBe(1)

    const rowCount = await db.evidenceLedger.count({ where: { missionId, idempotencyKey: input.idempotencyKey } })
    expect(rowCount).toBe(1)
  })
})
