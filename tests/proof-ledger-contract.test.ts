import { describe, expect, it } from 'bun:test'
import { sha256, canonicalJson } from '@/lib/proof-ledger'
import { readFileSync } from 'node:fs'

const schema = readFileSync('prisma/schema.prisma', 'utf8')

describe('proof ledger contracts', () => {
  it('canonical JSON is stable regardless of object key order', () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: 3 } })).toBe(canonicalJson({ a: { x: 3, y: 2 }, z: 1 }))
  })

  it('SHA-256 proof hashes are deterministic', () => {
    expect(sha256({ missionId: 'm1', value: 42 })).toBe(sha256({ value: 42, missionId: 'm1' }))
    expect(sha256({ missionId: 'm1', value: 42 })).not.toBe(sha256({ missionId: 'm1', value: 43 }))
  })

  it('proof models and uniqueness guards exist in the Prisma schema', () => {
    for (const model of ['ExecutionReceipt', 'EvidenceLedger', 'EvidenceSource', 'EvidenceClaim']) {
      expect(schema).toContain(`model ${model} {`)
    }
    expect(schema).toContain('@@unique([missionId, idempotencyKey])')
    expect(schema).toContain('@@unique([missionId, version])')
    expect(schema).toContain('@@unique([ledgerId, claimKey])')
    expect(schema).toContain('@@unique([ledgerId, sourceUrl, rawEvidenceHash])')
  })

  it('proof storage keeps raw evidence out of the database contract', () => {
    const sourceBlock = schema.match(/model EvidenceSource \{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(sourceBlock).toContain('rawEvidenceRef     String')
    expect(sourceBlock).toContain('rawEvidenceHash    String')
    expect(sourceBlock).not.toMatch(/rawEvidence\s+String/) 
  })

  it('proof records have explicit audit identity and integrity fields', () => {
    const receiptBlock = schema.match(/model ExecutionReceipt \{([\s\S]*?)\n\}/)?.[1] ?? ''
    const ledgerBlock = schema.match(/model EvidenceLedger \{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(receiptBlock).toContain('recordHash       String')
    expect(receiptBlock).toContain('idempotencyKey   String')
    expect(ledgerBlock).toContain('contentHash      String')
    expect(ledgerBlock).toContain('previousHash     String?')
  })
})
