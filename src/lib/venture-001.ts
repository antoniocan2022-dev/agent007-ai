/**
 * Venture 001 — canonical reference implementation for Venture OS.
 *
 * The reference venture is intentionally initialized as PROPOSED with zero
 * revenue/customers. No example KPI from VID documentation is copied into
 * production state. Real market evidence must earn the Venture Score before
 * lifecycle advancement.
 */
import { db } from './db'
import { createVenture, type VentureCreationResult } from './venture-os'
import { getPortfolio, type Business } from './business-portfolio'
import { VENTURE_SCORE_THRESHOLD } from './vid-data'

export const VENTURE_001_REFERENCE = {
  ventureKey: 'venture_001',
  version: 1,
  name: 'AI Book Business',
  type: 'digital_product' as const,
  description: 'Reference venture for the Agent007 Venture OS: a productized AI-assisted book creation business serving authors, coaches, consultants, and subject-matter experts.',
  targetMarket: 'Authors, coaches, consultants, educators, and subject-matter experts who want a professionally structured book without a traditional publishing workflow.',
  pricingModel: 'Validation-first: pricing is not treated as final until market evidence supports it.',
  initialMrrMilestone: 1000,
  lifecyclePolicy: ['proposed', 'validated', 'launched', 'active', 'scaling', 'automated', 'retired'] as const,
  requiredEvidence: [
    'market_demand',
    'competition',
    'automation_potential',
    'time_to_revenue',
    'scalability',
    'recurring_revenue',
    'ai_advantage',
  ] as const,
} as const

export interface Venture001State {
  reference: typeof VENTURE_001_REFERENCE
  initialized: boolean
  business: Business | null
  evidenceCount: number
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

export function validateVenture001Definition(): string[] {
  const issues: string[] = []
  if (VENTURE_001_REFERENCE.ventureKey !== 'venture_001') issues.push('Venture 001 key drifted.')
  if (VENTURE_001_REFERENCE.version !== 1) issues.push('Unexpected Venture 001 reference version.')
  if (!VENTURE_001_REFERENCE.name.trim()) issues.push('Venture 001 name is required.')
  if (VENTURE_SCORE_THRESHOLD !== 87) issues.push(`Venture Score threshold drifted from the canonical VID threshold: ${VENTURE_SCORE_THRESHOLD}.`)
  if (VENTURE_001_REFERENCE.initialMrrMilestone <= 0) issues.push('Initial MRR milestone must be positive.')
  if (VENTURE_001_REFERENCE.requiredEvidence.length !== 7) issues.push('Venture 001 must use all 7 canonical Venture Score dimensions.')
  return issues
}

async function findReferenceBusiness(): Promise<Business | null> {
  const portfolio = await getPortfolio()
  return portfolio.find((business) => normalize(business.name) === normalize(VENTURE_001_REFERENCE.name)) ?? null
}

async function countEvidence(businessId: string): Promise<number> {
  try {
    return await db.memory.count({
      where: { category: 'venture_evidence', key: { startsWith: `evidence_${businessId}_` } },
    })
  } catch {
    return 0
  }
}

async function persistReferenceIdentity(business: Business): Promise<void> {
  const key = 'venture_reference:venture_001'
  const value = JSON.stringify({ ventureKey: VENTURE_001_REFERENCE.ventureKey, version: VENTURE_001_REFERENCE.version, businessId: business.businessId, name: business.name })
  await db.memory.upsert({
    where: { key },
    update: { value, category: 'venture_reference' },
    create: { key, value, category: 'venture_reference' },
  })
}

export async function getVenture001State(): Promise<Venture001State> {
  const business = await findReferenceBusiness()
  return {
    reference: VENTURE_001_REFERENCE,
    initialized: Boolean(business),
    business,
    evidenceCount: business ? await countEvidence(business.businessId) : 0,
  }
}

/** Initialize exactly one canonical portfolio record; never seed synthetic performance. */
export async function ensureVenture001(): Promise<{ created: boolean; repaired: boolean; business: Business }> {
  const issues = validateVenture001Definition()
  if (issues.length) throw new Error(`Venture 001 definition invalid: ${issues.join(' | ')}`)

  const existing = await findReferenceBusiness()
  if (existing) {
    await persistReferenceIdentity(existing)
    return { created: false, repaired: false, business: existing }
  }

  const created: VentureCreationResult = await createVenture({
    name: VENTURE_001_REFERENCE.name,
    type: VENTURE_001_REFERENCE.type,
    description: VENTURE_001_REFERENCE.description,
    targetMarket: VENTURE_001_REFERENCE.targetMarket,
    pricingModel: VENTURE_001_REFERENCE.pricingModel,
  })
  if (!created.business) throw new Error(created.reason ?? 'Unable to create Venture 001.')

  await persistReferenceIdentity(created.business)
  return { created: created.created, repaired: false, business: created.business }
}
