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

  it('persists execution receipts idempotently and rejects conflicting reuse', async () => {
    const input = { missionId, actorId: 'SCOUT', actorType: 'specialist', action: 'research.fetch', status: 'SUCCESS', idempotencyKey: 'research-fetch-001', requestHash: 'request-hash-001', outputReference: 'evidence://raw/001' }
    const first = await recordExecutionReceipt(input)
    const second = await recordExecutionReceipt(input)
    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.receipt.id).toBe(first.receipt.id)
    expect(first.receipt.recordHash).toMatch(/^[a-f0-9]{64}$/)
    await expect(recordExecutionReceipt({ ...input, outputReference: 'evidence://raw/other' })).rejects.toThrow(/idempotency conflict/)
    expect(await db.executionReceipt.count({ where: { missionId, idempotencyKey: input.idempotencyKey } })).toBe(1)
  })

  it('persists evidence provenance atomically, is order-independent, and verifies its hash', async () => {
    const sources = [
      { provider: 'test-provider-a', sourceUrl: 'https://example.test/research/a', rawEvidenceRef: 'test://raw/a', rawEvidence: { result: { count: 1187 } } },
      { provider: 'test-provider-b', sourceUrl: 'https://example.test/research/b', rawEvidenceRef: 'test://raw/b', rawEvidence: { result: { style: 'modern' } } },
    ]
    const input = { missionId, title: 'Proof integration ledger', idempotencyKey: 'ledger-v1', sources, claims: [
      { claimKey: 'restaurant-count', claimText: 'The test provider reported 1187 restaurants.', classification: 'FACT' as const, confidence: 0.98, verificationStatus: 'VERIFIED' as const, sourceIndex: 0 },
      { claimKey: 'restaurant-style', claimText: 'The test provider reported modern cuisine.', classification: 'FACT' as const, confidence: 0.95, verificationStatus: 'VERIFIED' as const, sourceIndex: 1 },
    ] }
    const first = await persistEvidenceLedger(input)
    const reorderedSources = [...sources].reverse()
    const reorderedClaims = [
      { ...input.claims[0], sourceIndex: 1 },
      { ...input.claims[1], sourceIndex: 0 },
    ]
    const reordered = await persistEvidenceLedger({ ...input, sources: reorderedSources, claims: reorderedClaims })
    expect(first.created).toBe(true)
    expect(reordered.created).toBe(false)
    expect(reordered.ledger.id).toBe(first.ledger.id)
    expect(first.ledger.version).toBe(1)
    expect(first.ledger.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(first.ledger.Source).toHaveLength(2)
    expect(first.ledger.Claim).toHaveLength(2)
    const verification = await verifyEvidenceLedger(first.ledger.id)
    expect(verification.valid).toBe(true)
    expect(verification.actualHash).toBe(verification.expectedHash)
    expect(verification.sourceCount).toBe(2)
    expect(verification.claimCount).toBe(2)
    expect(await db.evidenceLedger.count({ where: { missionId, idempotencyKey: input.idempotencyKey } })).toBe(1)
  })

  it('rejects duplicate claim keys and duplicate source provenance before persistence', async () => {
    const source = { provider: 'duplicate-provider', sourceUrl: 'https://example.test/duplicate', rawEvidenceRef: 'test://raw/duplicate', rawEvidence: { same: true } }
    await expect(persistEvidenceLedger({ missionId, title: 'duplicate-claims', idempotencyKey: 'duplicate-claims', sources: [source], claims: [
      { claimKey: 'same', claimText: 'first', classification: 'FACT', confidence: 0.9, verificationStatus: 'UNVERIFIED' },
      { claimKey: 'same', claimText: 'second', classification: 'FACT', confidence: 0.9, verificationStatus: 'UNVERIFIED' },
    ] })).rejects.toThrow(/Duplicate evidence claim key/)
    await expect(persistEvidenceLedger({ missionId, title: 'duplicate-sources', idempotencyKey: 'duplicate-sources', sources: [source, source], claims: [] })).rejects.toThrow(/Duplicate evidence source provenance/)
  })
})
