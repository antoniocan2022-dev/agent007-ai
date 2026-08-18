/**
 * Venture OS canonical venture template — Upgrade 16.
 *
 * This file is the reusable structural contract for future ventures. It does
 * not create a venture, seed business performance, or authorize launch.
 * Venture 001 remains the canonical reference implementation.
 */

import { VENTURE_001_REFERENCE, validateVenture001Definition } from './venture-001'

export const VENTURE_TEMPLATE_VERSION = 1 as const

export const VENTURE_LIFECYCLE_POLICY = [
  'proposed', 'validated', 'launched', 'active', 'scaling', 'automated', 'retired',
] as const

export const VENTURE_EVIDENCE_TYPES = [
  'market_demand',
  'competition',
  'automation_potential',
  'time_to_revenue',
  'scalability',
  'recurring_revenue',
  'ai_advantage',
] as const

export interface VentureTemplate {
  templateKey: 'venture_os_canonical'
  version: number
  lifecyclePolicy: readonly string[]
  requiredEvidence: readonly string[]
  readiness: {
    contractRequired: true
    verifiedEvidenceRequired: true
    ownerApprovalRequiredForLaunch: true
    syntheticOutcomesForbidden: true
  }
  commercial: {
    paymentEvidenceRequired: true
    refundEvidenceRequired: true
    customerEvidenceRequired: true
  }
  artifact: {
    canonicalLedgerRequired: true
    verificationRequiredBeforeRelease: true
    supersessionRequiredForReplacement: true
  }
  referenceVenture: typeof VENTURE_001_REFERENCE
}

export const CANONICAL_VENTURE_TEMPLATE: VentureTemplate = Object.freeze({
  templateKey: 'venture_os_canonical',
  version: VENTURE_TEMPLATE_VERSION,
  lifecyclePolicy: VENTURE_LIFECYCLE_POLICY,
  requiredEvidence: VENTURE_EVIDENCE_TYPES,
  readiness: {
    contractRequired: true,
    verifiedEvidenceRequired: true,
    ownerApprovalRequiredForLaunch: true,
    syntheticOutcomesForbidden: true,
  },
  commercial: {
    paymentEvidenceRequired: true,
    refundEvidenceRequired: true,
    customerEvidenceRequired: true,
  },
  artifact: {
    canonicalLedgerRequired: true,
    verificationRequiredBeforeRelease: true,
    supersessionRequiredForReplacement: true,
  },
  referenceVenture: VENTURE_001_REFERENCE,
})

export function validateCanonicalVentureTemplate(): string[] {
  const errors: string[] = []
  if (CANONICAL_VENTURE_TEMPLATE.templateKey !== 'venture_os_canonical') errors.push('Canonical venture template key drifted.')
  if (CANONICAL_VENTURE_TEMPLATE.version !== VENTURE_TEMPLATE_VERSION) errors.push('Canonical venture template version drifted.')
  if (new Set(CANONICAL_VENTURE_TEMPLATE.lifecyclePolicy).size !== CANONICAL_VENTURE_TEMPLATE.lifecyclePolicy.length) errors.push('Venture template lifecycle contains duplicates.')
  if (CANONICAL_VENTURE_TEMPLATE.lifecyclePolicy.join('|') !== VENTURE_LIFECYCLE_POLICY.join('|')) errors.push('Venture template lifecycle policy drifted.')
  if (CANONICAL_VENTURE_TEMPLATE.requiredEvidence.length !== 7) errors.push('Venture template must contain exactly 7 canonical evidence dimensions.')
  if (CANONICAL_VENTURE_TEMPLATE.requiredEvidence.join('|') !== VENTURE_EVIDENCE_TYPES.join('|')) errors.push('Venture template evidence contract drifted.')
  if (CANONICAL_VENTURE_TEMPLATE.referenceVenture.requiredEvidence.join('|') !== VENTURE_EVIDENCE_TYPES.join('|')) errors.push('Venture 001 evidence contract no longer matches the canonical venture template.')
  errors.push(...validateVenture001Definition())
  return [...new Set(errors)]
}

export interface VentureBlueprint {
  ventureId: string
  name: string
  type: 'digital_product' | 'saas' | 'service' | 'marketplace' | 'media' | 'other'
  description: string
  targetMarket: string
  pricingModel: string
  lifecycleStage: 'proposed'
  templateKey: string
  templateVersion: number
  readinessRequired: true
  commercialEvidenceRequired: true
  createdAt: string
}

export function buildVentureBlueprint(input: Omit<VentureBlueprint, 'lifecycleStage' | 'templateKey' | 'templateVersion' | 'readinessRequired' | 'commercialEvidenceRequired'>): VentureBlueprint {
  const values = [input.ventureId, input.name, input.type, input.description, input.targetMarket, input.pricingModel]
  if (values.some((value) => !String(value).trim())) throw new Error('Venture blueprint requires ventureId, name, type, description, targetMarket, and pricingModel.')
  if (input.ventureId.trim() === 'venture_001') throw new Error('Venture 001 is canonical and cannot be regenerated from the factory.')
  return {
    ...input,
    ventureId: input.ventureId.trim(),
    name: input.name.trim(),
    description: input.description.trim(),
    targetMarket: input.targetMarket.trim(),
    pricingModel: input.pricingModel.trim(),
    lifecycleStage: 'proposed',
    templateKey: CANONICAL_VENTURE_TEMPLATE.templateKey,
    templateVersion: CANONICAL_VENTURE_TEMPLATE.version,
    readinessRequired: true,
    commercialEvidenceRequired: true,
  }
}
