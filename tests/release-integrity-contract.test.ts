import { describe, expect, test } from 'bun:test'
import { validateExactShaChain, validateReleaseAuthorization, validateReleaseIdentity, type ReleaseAuthorization } from '@/lib/release-integrity'

describe('release integrity contract', () => {
  const sha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const base: ReleaseAuthorization = {
    authorization: 'DEPLOY_AGENT007_MAIN',
    repository: 'antoniocan2022-dev/agent007-ai',
    ref: 'main',
    target: 'production',
    authorized: true,
    authorizedAt: '2026-08-29T10:00:00-04:00',
    expiresAt: '2026-08-29T18:00:00-04:00',
    sourceMainSha: sha,
  }

  test('accepts only a live authorization pinned to current main', () => {
    expect(validateReleaseAuthorization({ authorization: base, currentMainSha: sha, repository: base.repository, now: Date.parse('2026-08-29T17:00:00-04:00'), expectedTarget: 'production' })).toEqual({ valid: true, reason: 'AUTHORIZED' })
  })

  test('rejects malformed, stale, expired, wrong-target, wrong-repository, disabled, and wrong-token authorization', () => {
    expect(validateReleaseAuthorization({ authorization: base, currentMainSha: 'abc123', repository: base.repository, now: Date.parse('2026-08-29T11:00:00-04:00'), expectedTarget: 'production' }).reason).toBe('INVALID_SHA')
    expect(validateReleaseAuthorization({ authorization: base, currentMainSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', repository: base.repository, now: Date.parse('2026-08-29T11:00:00-04:00'), expectedTarget: 'production' }).reason).toBe('STALE_SHA')
    expect(validateReleaseAuthorization({ authorization: base, currentMainSha: sha, repository: base.repository, now: Date.parse('2026-08-29T19:00:00-04:00'), expectedTarget: 'production' }).reason).toBe('EXPIRED')
    expect(validateReleaseAuthorization({ authorization: { ...base, authorization: 'DEPLOY_AGENT007_MAIN' as const, target: 'preview' }, currentMainSha: sha, repository: base.repository, now: Date.parse('2026-08-29T17:00:00-04:00'), expectedTarget: 'production' }).reason).toBe('TARGET_MISMATCH')
    expect(validateReleaseAuthorization({ authorization: { ...base, repository: 'other/repo' }, currentMainSha: sha, repository: base.repository, now: Date.parse('2026-08-29T17:00:00-04:00'), expectedTarget: 'production' }).reason).toBe('REPOSITORY_MISMATCH')
    expect(validateReleaseAuthorization({ authorization: { ...base, authorized: false }, currentMainSha: sha, repository: base.repository, now: Date.parse('2026-08-29T17:00:00-04:00'), expectedTarget: 'production' }).reason).toBe('UNAUTHORIZED')
    expect(validateReleaseAuthorization({ authorization: { ...base, sourceMainSha: 'abc123' }, currentMainSha: sha, repository: base.repository, now: Date.parse('2026-08-29T17:00:00-04:00'), expectedTarget: 'production' }).reason).toBe('INVALID_SHA')
  })

  test('requires certification and deployment identities to be present, canonical, and bound to main', () => {
    expect(validateReleaseIdentity({ repository: base.repository, mainSha: sha, certificationSha: sha, deploymentSha: sha, target: 'production' })).toEqual({ valid: true, reason: 'AUTHORIZED' })
    expect(validateReleaseIdentity({ repository: base.repository, mainSha: sha, certificationSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', deploymentSha: sha, target: 'production' }).reason).toBe('CERTIFICATION_MISMATCH')
    expect(validateReleaseIdentity({ repository: base.repository, mainSha: sha, certificationSha: sha, deploymentSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', target: 'production' }).reason).toBe('DEPLOYMENT_MISMATCH')
    expect(validateReleaseIdentity({ repository: base.repository, mainSha: sha, certificationSha: sha, deploymentSha: null, target: 'production' }).reason).toBe('INVALID_SHA')
    expect(validateReleaseIdentity({ repository: 'repo', mainSha: sha, certificationSha: sha, deploymentSha: sha, target: 'production' }).reason).toBe('REPOSITORY_MISMATCH')
  })

  test('enforces authorized SHA == certified SHA == current main SHA == deployed SHA', () => {
    expect(validateExactShaChain({ authorizedSha: sha, certifiedSha: sha, currentMainSha: sha, deploymentSha: sha })).toEqual({ valid: true, reason: 'AUTHORIZED' })
    expect(validateExactShaChain({ authorizedSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', certifiedSha: sha, currentMainSha: sha, deploymentSha: sha }).reason).toBe('STALE_SHA')
    expect(validateExactShaChain({ authorizedSha: sha, certifiedSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', currentMainSha: sha, deploymentSha: sha }).reason).toBe('CERTIFICATION_MISMATCH')
    expect(validateExactShaChain({ authorizedSha: sha, certifiedSha: sha, currentMainSha: sha, deploymentSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }).reason).toBe('DEPLOYMENT_MISMATCH')
  })
})
