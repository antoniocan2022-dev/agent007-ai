export type ReleaseTarget = 'production' | 'preview'

export interface ReleaseAuthorization {
  authorization: 'DEPLOY_AGENT007_MAIN'
  repository: string
  ref: 'main'
  target: ReleaseTarget
  authorized: boolean
  authorizedAt: string
  expiresAt: string
  sourceMainSha: string | null
}

export interface ReleaseIdentity {
  repository: string
  mainSha: string
  certificationSha: string
  deploymentSha?: string | null
  target: ReleaseTarget
}

export interface ReleaseIntegrityResult {
  valid: boolean
  reason:
    | 'AUTHORIZED'
    | 'UNAUTHORIZED'
    | 'EXPIRED'
    | 'STALE_SHA'
    | 'INVALID_SHA'
    | 'REPOSITORY_MISMATCH'
    | 'REF_MISMATCH'
    | 'TARGET_MISMATCH'
    | 'CERTIFICATION_MISMATCH'
    | 'DEPLOYMENT_MISMATCH'
}

const SHA_RE = /^[0-9a-f]{40}$/

function parseTimestamp(value: string): number {
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : NaN
}

export function validateReleaseAuthorization(input: {
  authorization: ReleaseAuthorization
  currentMainSha: string
  repository: string
  now?: number
  expectedTarget?: ReleaseTarget
}): ReleaseIntegrityResult {
  const { authorization, currentMainSha, repository } = input
  const now = input.now ?? Date.now()
  if (!SHA_RE.test(currentMainSha)) return { valid: false, reason: 'INVALID_SHA' }
  if (!authorization.authorized) return { valid: false, reason: 'UNAUTHORIZED' }
  if (authorization.repository !== repository) return { valid: false, reason: 'REPOSITORY_MISMATCH' }
  if (authorization.ref !== 'main') return { valid: false, reason: 'REF_MISMATCH' }
  if (input.expectedTarget && authorization.target !== input.expectedTarget) return { valid: false, reason: 'TARGET_MISMATCH' }
  const expiresAt = parseTimestamp(authorization.expiresAt)
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return { valid: false, reason: 'EXPIRED' }
  if (!authorization.sourceMainSha) return { valid: false, reason: 'STALE_SHA' }
  if (!SHA_RE.test(authorization.sourceMainSha)) return { valid: false, reason: 'INVALID_SHA' }
  if (authorization.sourceMainSha !== currentMainSha) return { valid: false, reason: 'STALE_SHA' }
  return { valid: true, reason: 'AUTHORIZED' }
}

export function validateReleaseIdentity(input: ReleaseIdentity): ReleaseIntegrityResult {
  if (!SHA_RE.test(input.mainSha) || !SHA_RE.test(input.certificationSha) || (input.deploymentSha && !SHA_RE.test(input.deploymentSha))) return { valid: false, reason: 'INVALID_SHA' }
  if (input.certificationSha !== input.mainSha) return { valid: false, reason: 'CERTIFICATION_MISMATCH' }
  if (input.deploymentSha && input.deploymentSha !== input.mainSha) return { valid: false, reason: 'DEPLOYMENT_MISMATCH' }
  return { valid: true, reason: 'AUTHORIZED' }
}
