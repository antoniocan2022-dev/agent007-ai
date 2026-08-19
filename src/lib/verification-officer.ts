import { sha256 } from './proof-ledger'

export const VERIFICATION_OFFICER_ID = 'verification_officer'
export const VERIFICATION_OFFICER_VERSION = 1

export type VerificationDecision = 'PASS' | 'CHALLENGE' | 'FAIL'
export type VerificationClaimType = 'FACT' | 'HYPOTHESIS' | 'INFERENCE'

export interface VerificationSource {
  sourceId: string
  provider: string
  sourceUrl: string
  retrievedAt: string
  independentGroup?: string
}

export interface VerificationClaim {
  claimKey: string
  value: string
  claimType: VerificationClaimType
  confidence: number
  sourceIds: string[]
  critical?: boolean
}

export interface VerificationOfficerInput {
  missionId: string
  subject: string
  producerId: string
  claims: VerificationClaim[]
  sources: VerificationSource[]
  requiredClaimKeys?: string[]
}

export interface VerificationFinding {
  code:
    | 'INVALID_INPUT'
    | 'SELF_VERIFICATION'
    | 'MISSING_SOURCE'
    | 'INSUFFICIENT_INDEPENDENCE'
    | 'LOW_CONFIDENCE'
    | 'CONFLICTING_CLAIMS'
    | 'MISSING_REQUIRED_CLAIM'
    | 'UNSUPPORTED_CLAIM'
  claimKey?: string
  message: string
}

export interface VerificationOfficerResult {
  decision: VerificationDecision
  officerId: typeof VERIFICATION_OFFICER_ID
  version: typeof VERIFICATION_OFFICER_VERSION
  missionId: string
  subject: string
  findings: VerificationFinding[]
  challengedClaimKeys: string[]
  proofHash: string
}

const clean = (value: string): string => value.trim().replace(/\\s+/g, ' ')
const normalizeValue = (value: string): string => clean(value).toLowerCase()

function addFinding(findings: VerificationFinding[], finding: VerificationFinding): void {
  if (findings.some((item) => item.code === finding.code && item.claimKey === finding.claimKey && item.message === finding.message)) return
  findings.push(finding)
}

/**
 * Independent challenge gate for externally sourced recommendations.
 * The officer never edits the producer's claims; it judges whether those claims
 * have sufficient, independent and non-conflicting evidence to be accepted.
 */
export function runVerificationOfficerChallenge(input: VerificationOfficerInput): VerificationOfficerResult {
  const findings: VerificationFinding[] = []
  const requiredClaimKeys = new Set((input.requiredClaimKeys ?? []).map(clean).filter(Boolean))

  if (!clean(input.missionId) || !clean(input.subject) || !clean(input.producerId)) {
    addFinding(findings, { code: 'INVALID_INPUT', message: 'missionId, subject and producerId are required.' })
  }
  if (normalizeValue(input.producerId) === VERIFICATION_OFFICER_ID) {
    addFinding(findings, { code: 'SELF_VERIFICATION', message: 'Verification Officer cannot independently verify its own work.' })
  }
  if (!Array.isArray(input.claims) || input.claims.length === 0) {
    addFinding(findings, { code: 'INVALID_INPUT', message: 'At least one claim is required.' })
  }
  if (!Array.isArray(input.sources) || input.sources.length === 0) {
    addFinding(findings, { code: 'INVALID_INPUT', message: 'At least one independent evidence source is required.' })
  }

  const sources = new Map<string, VerificationSource>()
  for (const source of input.sources ?? []) {
    const sourceId = clean(source.sourceId)
    const provider = clean(source.provider)
    const sourceUrl = clean(source.sourceUrl)
    if (!sourceId || !provider || !sourceUrl || !Number.isFinite(Date.parse(source.retrievedAt))) {
      addFinding(findings, { code: 'INVALID_INPUT', message: `Invalid evidence source: ${sourceId || '(unnamed)'}.` })
      continue
    }
    if (sources.has(sourceId)) {
      addFinding(findings, { code: 'CONFLICTING_CLAIMS', message: `Duplicate evidence source id: ${sourceId}.` })
      continue
    }
    sources.set(sourceId, { ...source, sourceId, provider, sourceUrl })
  }

  const claimsByKey = new Map<string, VerificationClaim[]>()
  for (const rawClaim of input.claims ?? []) {
    const claimKey = clean(rawClaim.claimKey)
    const value = clean(rawClaim.value)
    const sourceIds = [...new Set((rawClaim.sourceIds ?? []).map(clean).filter(Boolean))]
    if (!claimKey || !value || !rawClaim.claimType || !Number.isFinite(rawClaim.confidence) || rawClaim.confidence < 0 || rawClaim.confidence > 1) {
      addFinding(findings, { code: 'INVALID_INPUT', claimKey: claimKey || undefined, message: `Invalid verification claim: ${claimKey || '(unnamed)'}.` })
      continue
    }

    for (const sourceId of sourceIds) {
      if (!sources.has(sourceId)) addFinding(findings, { code: 'MISSING_SOURCE', claimKey, message: `Claim ${claimKey} references missing source ${sourceId}.` })
    }

    const usableSources = sourceIds.map((sourceId) => sources.get(sourceId)).filter((source): source is VerificationSource => Boolean(source))
    const independentGroups = new Set(usableSources.map((source) => clean(source.independentGroup || source.provider).toLowerCase()))
    const minimumIndependentSources = rawClaim.critical ? 2 : 1
    if (independentGroups.size < minimumIndependentSources) {
      addFinding(findings, {
        code: 'INSUFFICIENT_INDEPENDENCE',
        claimKey,
        message: `Claim ${claimKey} requires at least ${minimumIndependentSources} independent evidence source group(s), found ${independentGroups.size}.`,
      })
    }

    if (rawClaim.claimType === 'FACT' && rawClaim.confidence < 0.8) {
      addFinding(findings, { code: 'LOW_CONFIDENCE', claimKey, message: `Factual claim ${claimKey} has confidence below the 0.8 verification threshold.` })
    }

    const normalizedClaim: VerificationClaim = { ...rawClaim, claimKey, value, sourceIds }
    const claims = claimsByKey.get(claimKey) ?? []
    claims.push(normalizedClaim)
    claimsByKey.set(claimKey, claims)
  }

  for (const [claimKey, claims] of claimsByKey.entries()) {
    const values = new Set(claims.map((claim) => normalizeValue(claim.value)))
    if (values.size > 1) {
      addFinding(findings, { code: 'CONFLICTING_CLAIMS', claimKey, message: `Independent sources do not agree on claim ${claimKey}.` })
    }
  }

  for (const requiredClaimKey of requiredClaimKeys) {
    if (!claimsByKey.has(requiredClaimKey)) addFinding(findings, { code: 'MISSING_REQUIRED_CLAIM', claimKey: requiredClaimKey, message: `Required claim ${requiredClaimKey} is missing.` })
  }

  const challengedClaimKeys = [...new Set(findings.filter((finding) => finding.claimKey).map((finding) => finding.claimKey as string))]
  const fatalCodes = new Set<VerificationFinding['code']>([
    'INVALID_INPUT',
    'SELF_VERIFICATION',
    'MISSING_SOURCE',
    'INSUFFICIENT_INDEPENDENCE',
    'CONFLICTING_CLAIMS',
    'MISSING_REQUIRED_CLAIM',
  ])
  const hasFatal = findings.some((finding) => fatalCodes.has(finding.code))
  const decision: VerificationDecision = hasFatal ? 'CHALLENGE' : findings.length > 0 ? 'CHALLENGE' : 'PASS'

  return {
    decision,
    officerId: VERIFICATION_OFFICER_ID,
    version: VERIFICATION_OFFICER_VERSION,
    missionId: clean(input.missionId),
    subject: clean(input.subject),
    findings,
    challengedClaimKeys,
    proofHash: sha256({
      officerId: VERIFICATION_OFFICER_ID,
      version: VERIFICATION_OFFICER_VERSION,
      missionId: clean(input.missionId),
      subject: clean(input.subject),
      producerId: clean(input.producerId),
      claims: input.claims,
      sources: input.sources,
      requiredClaimKeys: [...requiredClaimKeys].sort(),
      findings,
    }),
  }
}
