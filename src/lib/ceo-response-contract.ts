import { createHash } from 'node:crypto'
import type { QualityDecision, QualityResult } from './ceo-cognitive-contract'

export interface CeoResponseCandidate {
  candidateId: string
  requestId?: string
  content: string
  contentHash: string
  createdAt: number
}

export interface CeoQualityDecision {
  decisionId: string
  candidateId: string
  candidateHash: string
  decision: QualityDecision
  reasons: readonly string[]
  decidedAt: number
}

export interface CeoResponseDecisionEnvelope {
  candidate: CeoResponseCandidate
  quality: CeoQualityDecision
}

export function buildCeoResponseCandidate(input: { content: string; requestId?: string }): CeoResponseCandidate {
  const content = input.content.trim()
  const contentHash = createHash('sha256').update(content, 'utf8').digest('hex')
  return Object.freeze({
    candidateId: `ceo-candidate-${contentHash.slice(0, 16)}`,
    requestId: input.requestId,
    content,
    contentHash,
    createdAt: Date.now(),
  })
}

export function decideCeoCandidate(candidate: CeoResponseCandidate, quality: QualityResult): CeoQualityDecision {
  if (candidate.contentHash !== createHash('sha256').update(candidate.content, 'utf8').digest('hex')) {
    throw new Error('CEO_CANDIDATE_IDENTITY_MISMATCH')
  }
  return Object.freeze({
    decisionId: `ceo-decision-${createHash('sha256').update(`${candidate.contentHash}:${quality.decision}:${quality.reasons.join('|')}`, 'utf8').digest('hex').slice(0, 16)}`,
    candidateId: candidate.candidateId,
    candidateHash: candidate.contentHash,
    decision: quality.decision,
    reasons: Object.freeze([...quality.reasons]),
    decidedAt: Date.now(),
  })
}

export function buildCeoResponseDecisionEnvelope(input: { content: string; quality: QualityResult; requestId?: string }): CeoResponseDecisionEnvelope {
  const candidate = buildCeoResponseCandidate({ content: input.content, requestId: input.requestId })
  return Object.freeze({ candidate, quality: decideCeoCandidate(candidate, input.quality) })
}

export function assertCeoResponseDecisionEnvelope(envelope: CeoResponseDecisionEnvelope): void {
  const expectedHash = createHash('sha256').update(envelope.candidate.content, 'utf8').digest('hex')
  if (expectedHash !== envelope.candidate.contentHash || envelope.quality.candidateId !== envelope.candidate.candidateId || envelope.quality.candidateHash !== expectedHash) {
    throw new Error('CEO_RESPONSE_DECISION_ENVELOPE_MISMATCH')
  }
}
