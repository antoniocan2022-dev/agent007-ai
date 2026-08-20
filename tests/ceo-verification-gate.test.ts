import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/lib/ceo-presenter.ts', import.meta.url), 'utf8')

describe('CEO verification hard gate', () => {
  test('CEO success requires an independent PASS decision', () => {
    expect(source).toContain("allApproved && verification.decision === 'PASS'")
    expect(source).toContain('No evidence ledger exists for this mission')
    expect(source).toContain('executeVerificationOfficerChallenge')
  })

  test('CEO output carries explicit verification state', () => {
    expect(source).toContain('verificationDecision')
    expect(source).toContain('verificationProofHash')
    expect(source).toContain('Verification Officer gate')
  })
})
