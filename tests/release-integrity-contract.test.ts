import { describe, expect, test } from 'bun:test'
import { validateReleaseAuthorization, validateReleaseIdentity, type ReleaseAuthorization } from '@/lib/release-integrity'

describe('release integrity contract', () => {
  const base: ReleaseAuthorization = {
    authorization: 'DEPLOY_AGENT007_MAIN',
    repository: 'antoniocan2022-dev/agent007-ai',
    ref: 'main',
    target: 'production',
    authorized: true,
    authorizedAt: '2026-08-29T10:00:00-04:00',
    expiresAt: '2026-08-29T12:00:00-04:00',
    sourceMainSha: 'abc123',
  }

  test('accepts only a live authorization pinned to current main', () => {
    expect(validateReleaseAuthorization({ authorization: base, currentMainSha: 'abc123', repository: base.repository, now: Date.parse('2026-08-29T11:00:00-04:00'), expectedTarget: 'production' })).toEqual({ valid: true, reason: 'AUTHORIZED' })
  })

  test('rejects stale, expired, wrong-target, wrong-repository, and disabled authorization', () => {
    expect(validateReleaseAuthorization({ authorization: base, currentMainSha: 'different', repository: base.repository, now: Date.parse('2026-08-29T11:00:00-04:00'), expectedTarget: 'production' }).reason).toBe('STALE_SHA')
    expect(validateReleaseAuthorization({ authorization: base, currentMainSha: 'abc123', repository: base.repository, now: Date.parse('2026-08-29T13:00:00-04:00'), expectedTarget: 'production' }).reason).toBe('EXPIRED')
    expect(validateReleaseAuthorization({ authorization: { ...base, target: 'preview' }, currentMainSha: 'abc123', repository: base.repository, now: Date.parse('2026-08-29T11:00:00-04:00'), expectedTarget: 'production' }).reason).toBe('TARGET_MISMATCH')
    expect(validateReleaseAuthorization({ authorization: { ...base, repository: 'other/repo' }, currentMainSha: 'abc123', repository: base.repository, now: Date.parse('2026-08-29T11:00:00-04:00'), expectedTarget: 'production' }).reason).toBe('REPOSITORY_MISMATCH')
    expect(validateReleaseAuthorization({ authorization: { ...base, authorized: false }, currentMainSha: 'abc123', repository: base.repository, now: Date.parse('2026-08-29T11:00:00-04:00'), expectedTarget: 'production' }).reason).toBe('UNAUTHORIZED')
  })

  test('requires the certification and deployment identity to remain bound to main', () => {
    expect(validateReleaseIdentity({ repository: base.repository, mainSha: 'abc123', certificationSha: 'abc123', deploymentSha: 'abc123', target: 'production' })).toEqual({ valid: true, reason: 'AUTHORIZED' })
    expect(validateReleaseIdentity({ repository: base.repository, mainSha: 'abc123', certificationSha: 'other', deploymentSha: null, target: 'production' }).reason).toBe('CERTIFICATION_MISMATCH')
    expect(validateReleaseIdentity({ repository: base.repository, mainSha: 'abc123', certificationSha: 'abc123', deploymentSha: 'other', target: 'production' }).reason).toBe('DEPLOYMENT_MISMATCH')
  })
})
