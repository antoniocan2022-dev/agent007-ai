import { describe, expect, test } from 'bun:test'
import { createReleaseAttestation, newReleaseRequestId, verifyReleaseTriplet, type ReleaseIdentity } from '@/lib/release-attestation'

describe('release attestation', () => {
  const identity: ReleaseIdentity = {
    deploymentId: 'dpl_test123',
    vercelCommitSha: 'a'.repeat(40),
    releaseCommitSha: 'a'.repeat(40),
    environment: 'production',
  }

  test('requires exact GitHub/build/runtime SHA equality', () => {
    expect(verifyReleaseTriplet({ githubMainSha: 'a'.repeat(40), identity }).verified).toBe(true)
    expect(verifyReleaseTriplet({ githubMainSha: 'b'.repeat(40), identity }).verified).toBe(false)
    expect(verifyReleaseTriplet({ githubMainSha: 'a'.repeat(40), identity: { ...identity, releaseCommitSha: 'b'.repeat(40) } }).verified).toBe(false)
  })

  test('attestation is deterministic for the same runtime request', () => {
    const requestId = 'request-fixed'
    const first = createReleaseAttestation(identity, requestId)
    const second = createReleaseAttestation(identity, requestId)
    expect(first.fingerprint).toBe(second.fingerprint)
    expect(first.executedCommitSha).toBe(identity.releaseCommitSha)
  })

  test('request ids are bounded and regenerated when missing', () => {
    expect(newReleaseRequestId('request-fixed')).toBe('request-fixed')
    expect(newReleaseRequestId('')).not.toBe('')
    expect(newReleaseRequestId('x'.repeat(121))).not.toHaveLength(121)
  })
})
