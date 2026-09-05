import { describe, expect, test } from 'bun:test'
import { assertCeoResponseDecisionEnvelope, buildCeoResponseDecisionEnvelope } from '../src/lib/ceo-response-contract'
import { finalizeCeoResponse, assertFinalResponseInvariant } from '../src/lib/ceo-response-finalizer'
import type { QualityResult } from '../src/lib/ceo-cognitive-contract'

const quality: QualityResult = {
  decision: 'PASS',
  evidenceState: 'NOT_APPLICABLE',
  verificationStatus: 'NOT_REQUIRED',
  checks: { nonEmpty: true, contractValid: true, objectiveCoverage: true, internalConsistency: true, evidenceDiscipline: true, actionableStructure: true },
  reasons: ['accepted'],
}

describe('CEO authoritative response contract', () => {
  test('binds exactly one immutable candidate to one immutable quality decision', () => {
    const envelope = buildCeoResponseDecisionEnvelope({ content: 'The operations kit should come first.', quality, requestId: 'req-1' })
    expect(Object.isFrozen(envelope)).toBe(true)
    expect(Object.isFrozen(envelope.candidate)).toBe(true)
    expect(Object.isFrozen(envelope.quality)).toBe(true)
    expect(envelope.candidate.contentHash).toHaveLength(64)
    expect(envelope.quality.candidateId).toBe(envelope.candidate.candidateId)
    expect(envelope.quality.candidateHash).toBe(envelope.candidate.contentHash)
    assertCeoResponseDecisionEnvelope(envelope)
  })

  test('finalizer rejects a candidate-content mismatch before producing a response', () => {
    const envelope = buildCeoResponseDecisionEnvelope({ content: 'Canonical answer.', quality })
    expect(() => finalizeCeoResponse({ content: 'Tampered answer.', decisionEnvelope: envelope })).toThrow('CEO_RESPONSE_CANDIDATE_MISMATCH')
  })

  test('final response has stable identity', () => {
    const envelope = buildCeoResponseDecisionEnvelope({ content: 'Stable answer.', quality })
    const finalized = finalizeCeoResponse({ content: envelope.candidate.content, decisionEnvelope: envelope })
    assertFinalResponseInvariant(finalized)
    expect(finalized.candidateId).toBe(envelope.candidate.candidateId)
    expect(finalized.qualityDecisionId).toBe(envelope.quality.decisionId)
    expect(finalized.candidateHash).toBe(envelope.candidate.contentHash)
  })
})
