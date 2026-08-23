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
import { assertVentureActionAllowed, ensureVentureControlContract } from './architecture-control-plane'
import { createOrGetVenture } from './venture-commercial-foundation'

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
  requiredEvidence: ['market_demand', 'competition', 'automation_potential', 'time_to_revenue', 'scalability', 'recurring_revenue', 'ai_advantage'] as const,
} as const

export interface Venture001State { reference: typeof VENTURE_001_REFERENCE; initialized: boolean; business: Business | null; evidenceCount: number; duplicateCount: number; integrityIssues: string[] }
function normalize(value: string): string { return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase() }
export function validateVenture001Definition(): string[] { const issues: string[] = []; if (VENTURE_001_REFERENCE.ventureKey !== 'venture_001') issues.push('Venture 001 key drifted.'); if (VENTURE_001_REFERENCE.version !== 1) issues.push('Unexpected Venture 001 reference version.'); if (!VENTURE_001_REFERENCE.name.trim()) issues.push('Venture 001 name is required.'); if (VENTURE_SCORE_THRESHOLD !== 87) issues.push(`Venture Score threshold drifted from the canonical VID threshold: ${VENTURE_SCORE_THRESHOLD}.`); if (VENTURE_001_REFERENCE.initialMrrMilestone <= 0) issues.push('Initial MRR milestone must be positive.'); if (VENTURE_001_REFERENCE.requiredEvidence.length !== 7) issues.push('Venture 001 must use all 7 canonical Venture Score dimensions.'); if (new Set(VENTURE_001_REFERENCE.lifecyclePolicy).size !== VENTURE_001_REFERENCE.lifecyclePolicy.length) issues.push('Venture 001 lifecycle policy contains duplicate stages.'); return issues }
async function findReferenceBusinesses(): Promise<Business[]> { const portfolio = await getPortfolio(); return portfolio.filter((business) => normalize(business.name) === normalize(VENTURE_001_REFERENCE.name)) }
async function getIdentityBusiness(): Promise<Business | null> { const identity = await db.memory.findUnique({ where: { key: 'venture_reference:venture_001' } }); if (!identity) return null; try { const parsed = JSON.parse(identity.value) as { businessId?: string }; if (!parsed.businessId) return null; const portfolio = await getPortfolio(); return portfolio.find((business) => business.businessId === parsed.businessId) ?? null } catch { return null } }
async function countEvidence(businessId: string): Promise<number> { return db.memory.count({ where: { category: 'venture_evidence', key: { startsWith: `evidence_${businessId}_` } } }) }
async function persistReferenceIdentity(business: Business): Promise<void> { const key='venture_reference:venture_001'; const value=JSON.stringify({ ventureKey: VENTURE_001_REFERENCE.ventureKey, version: VENTURE_001_REFERENCE.version, businessId: business.businessId, name: business.name }); await db.memory.upsert({ where: { key }, update: { value, category: 'venture_reference' }, create: { key, value, category: 'venture_reference' } }) }

export async function getVenture001State(): Promise<Venture001State> { const businesses=await findReferenceBusinesses(); const identityBusiness=await getIdentityBusiness(); const business=identityBusiness??businesses[0]??null; const duplicateCount=Math.max(0,businesses.length-1); const integrityIssues=validateVenture001Definition(); if(businesses.length>1) integrityIssues.push(`Duplicate Venture 001 portfolio records detected: ${businesses.length}. Canonical state is not safe to mutate until reconciled.`); if(identityBusiness&&!businesses.some((candidate)=>candidate.businessId===identityBusiness.businessId)) integrityIssues.push('Venture 001 identity points to a portfolio record that does not match the canonical Venture 001 name.'); return { reference:VENTURE_001_REFERENCE, initialized:Boolean(business), business, evidenceCount:business?await countEvidence(business.businessId):0, duplicateCount, integrityIssues } }

/** Initialize exactly one canonical portfolio record and, when ownerUserId is provided, its relational Venture identity. */
export async function ensureVenture001(ownerUserId?: string): Promise<{ created: boolean; repaired: boolean; business: Business }> {
  const issues=validateVenture001Definition(); if(issues.length) throw new Error(`Venture 001 definition invalid: ${issues.join(' | ')}`)
  await ensureVentureControlContract(VENTURE_001_REFERENCE.ventureKey); await assertVentureActionAllowed(VENTURE_001_REFERENCE.ventureKey,'create_artifact')
  const existing=await findReferenceBusinesses(); if(existing.length>1) throw new Error(`Venture 001 integrity failure: ${existing.length} portfolio records share the canonical name. Reconcile duplicates before mutation.`)
  const identityBusiness=await getIdentityBusiness()
  if(identityBusiness){ if(ownerUserId) await createOrGetVenture({ ventureKey: VENTURE_001_REFERENCE.ventureKey, businessUnitId: null, ownerUserId, name: VENTURE_001_REFERENCE.name, type: VENTURE_001_REFERENCE.type, description: VENTURE_001_REFERENCE.description, targetMarket: VENTURE_001_REFERENCE.targetMarket, pricingModel: VENTURE_001_REFERENCE.pricingModel, status: 'REFERENCE', productionState: 'STRUCTURAL_ONLY' }); await persistReferenceIdentity(identityBusiness); return { created:false, repaired:false, business:identityBusiness } }
  if(existing[0]){ if(ownerUserId) await createOrGetVenture({ ventureKey: VENTURE_001_REFERENCE.ventureKey, businessUnitId:null, ownerUserId, name:VENTURE_001_REFERENCE.name, type:VENTURE_001_REFERENCE.type, description:VENTURE_001_REFERENCE.description, targetMarket:VENTURE_001_REFERENCE.targetMarket, pricingModel:VENTURE_001_REFERENCE.pricingModel, status:'REFERENCE', productionState:'STRUCTURAL_ONLY' }); await persistReferenceIdentity(existing[0]); return { created:false, repaired:true, business:existing[0] } }
  const created:VentureCreationResult=await createVenture({name:VENTURE_001_REFERENCE.name,type:VENTURE_001_REFERENCE.type,description:VENTURE_001_REFERENCE.description,targetMarket:VENTURE_001_REFERENCE.targetMarket,pricingModel:VENTURE_001_REFERENCE.pricingModel}); if(!created.business) throw new Error(created.reason??'Unable to create Venture 001.'); if(ownerUserId) await createOrGetVenture({ ventureKey:VENTURE_001_REFERENCE.ventureKey, businessUnitId:null, ownerUserId, name:VENTURE_001_REFERENCE.name, type:VENTURE_001_REFERENCE.type, description:VENTURE_001_REFERENCE.description, targetMarket:VENTURE_001_REFERENCE.targetMarket, pricingModel:VENTURE_001_REFERENCE.pricingModel, status:'REFERENCE', productionState:'STRUCTURAL_ONLY' }); await persistReferenceIdentity(created.business); return { created:created.created, repaired:false, business:created.business }
}
