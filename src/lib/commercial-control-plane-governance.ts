import { db } from './db'
import {
  COMMERCIAL_BUSINESSES,
  COMMERCIAL_CATEGORIES,
  COMMERCIAL_CONTROL_PLANE_ID,
  COMMERCIAL_CONTROL_PLANE_VERSION,
  type AuthorityLevel,
  type BillingRecord,
  type CommercialAuditRecord,
  type CommercialBusiness,
  type CommercialControlPlaneSnapshot,
  type CommercialEvidence,
  type DelegatedAuthority,
  type Entitlement,
} from './commercial-control-plane'

export async function recordBilling(input: Omit<BillingRecord, 'billingId' | 'createdAt' | 'updatedAt'> & { billingId?: string }): Promise<{ created: boolean; billing: BillingRecord }> {
  if (!input.tenantId.trim() || !COMMERCIAL_BUSINESSES.includes(input.business)) throw new Error('Valid tenantId and business are required.')
  const amount = Number.isFinite(input.amount) ? Math.max(0, input.amount) : 0
  const currency = input.currency.trim().toUpperCase()
  if (currency.length !== 3) throw new Error('currency must be a three-letter code.')
  if (!input.product.trim() || !input.idempotencyKey.trim()) throw new Error('product and idempotencyKey are required.')
  const timestamp = new Date().toISOString()
  const billing: BillingRecord = { ...input, billingId: input.billingId?.trim() || `bill_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, amount, currency, product: input.product.trim(), idempotencyKey: input.idempotencyKey.trim(), createdAt: timestamp, updatedAt: timestamp }
  const key = `billing:${input.tenantId}:${billing.idempotencyKey}`
  const existing = await db.memory.findUnique({ where: { key } })
  if (existing) return { created: false, billing: JSON.parse(existing.value) as BillingRecord }
  await db.memory.create({ data: { key, category: COMMERCIAL_CATEGORIES.billing, value: JSON.stringify(billing) } })
  return { created: true, billing }
}

export async function grantEntitlement(input: Omit<Entitlement, 'entitlementId' | 'createdAt' | 'updatedAt'> & { entitlementId?: string }): Promise<{ created: boolean; entitlement: Entitlement }> {
  if (!input.tenantId.trim() || !COMMERCIAL_BUSINESSES.includes(input.business)) throw new Error('Valid tenantId and business are required.')
  if (!input.product.trim() || !input.subjectId.trim()) throw new Error('product and subjectId are required.')
  const timestamp = new Date().toISOString()
  const entitlement: Entitlement = { ...input, entitlementId: input.entitlementId?.trim() || `ent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, product: input.product.trim(), subjectId: input.subjectId.trim(), limits: Object.fromEntries(Object.entries(input.limits ?? {}).map(([key, value]) => [key.trim(), Number.isFinite(value) ? Math.max(0, value) : 0])), createdAt: timestamp, updatedAt: timestamp }
  const key = `entitlement:${input.tenantId}:${entitlement.product}:${entitlement.subjectId}`
  const existing = await db.memory.findUnique({ where: { key } })
  if (existing) return { created: false, entitlement: JSON.parse(existing.value) as Entitlement }
  await db.memory.create({ data: { key, category: COMMERCIAL_CATEGORIES.entitlement, value: JSON.stringify(entitlement) } })
  return { created: true, entitlement }
}

export async function recordCommercialEvidence(input: Omit<CommercialEvidence, 'evidenceId' | 'createdAt'> & { evidenceId?: string }): Promise<CommercialEvidence> {
  if (!input.tenantId.trim() || !COMMERCIAL_BUSINESSES.includes(input.business)) throw new Error('Valid tenantId and business are required.')
  if (!input.source.trim() || !input.statement.trim()) throw new Error('Evidence source and statement are required.')
  const evidence: CommercialEvidence = { ...input, evidenceId: input.evidenceId?.trim() || `ce_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, source: input.source.trim(), statement: input.statement.trim(), confidence: Number.isFinite(input.confidence) ? Math.max(0, Math.min(1, input.confidence)) : 0, createdAt: new Date().toISOString() }
  await db.memory.create({ data: { key: `evidence:${input.tenantId}:${evidence.evidenceId}`, category: COMMERCIAL_CATEGORIES.evidence, value: JSON.stringify(evidence) } })
  return evidence
}

export async function grantDelegatedAuthority(input: Omit<DelegatedAuthority, 'authorityId'> & { authorityId?: string }): Promise<DelegatedAuthority> {
  if (!input.tenantId.trim() || !COMMERCIAL_BUSINESSES.includes(input.business)) throw new Error('Valid tenantId and business are required.')
  if (!input.action.trim() || !input.approvedByUserId.trim()) throw new Error('action and approvedByUserId are required.')
  if (input.level === 'autonomous' && input.maxSpend !== null && input.maxSpend < 0) throw new Error('maxSpend must be non-negative.')
  const authority: DelegatedAuthority = { ...input, authorityId: input.authorityId?.trim() || `auth_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, action: input.action.trim(), maxSpend: input.maxSpend === null ? null : Math.max(0, input.maxSpend), maxDailyCount: input.maxDailyCount === null ? null : Math.max(0, Math.floor(input.maxDailyCount)), allowedChannels: [...new Set((input.allowedChannels ?? []).map((item) => item.trim()).filter(Boolean))] }
  const key = `authority:${input.tenantId}:${authority.authorityId}`
  const existing = await db.memory.findUnique({ where: { key } })
  if (existing) return JSON.parse(existing.value) as DelegatedAuthority
  await db.memory.create({ data: { key, category: COMMERCIAL_CATEGORIES.authority, value: JSON.stringify(authority) } })
  return authority
}

export async function evaluateDelegatedAuthority(input: { tenantId: string; business: CommercialBusiness; action: string; spend?: number; channel?: string; dailyCount?: number }): Promise<{ allowed: boolean; authority: DelegatedAuthority | null; reason: string }> {
  const records = await db.memory.findMany({ where: { category: COMMERCIAL_CATEGORIES.authority } })
  const now = Date.now()
  const matches = records.map((record) => { try { return JSON.parse(record.value) as DelegatedAuthority } catch { return null } }).filter((authority): authority is DelegatedAuthority => !!authority && authority.tenantId === input.tenantId && authority.business === input.business && authority.action === input.action.trim() && authority.status === 'active' && (!authority.expiresAt || new Date(authority.expiresAt).getTime() > now))
  const authority = matches.find((item) => item.level === 'autonomous' || item.level === 'guardrailed') ?? matches[0] ?? null
  if (!authority) return { allowed: false, authority: null, reason: 'No active delegated authority matches this action.' }
  if (authority.level === 'human_approval' || authority.level === 'forbidden') return { allowed: false, authority, reason: `Authority level ${authority.level} does not permit autonomous execution.` }
  if (authority.maxSpend !== null && Math.max(0, input.spend ?? 0) > authority.maxSpend) return { allowed: false, authority, reason: 'Requested spend exceeds delegated authority.' }
  if (authority.maxDailyCount !== null && Math.max(0, Math.floor(input.dailyCount ?? 0)) > authority.maxDailyCount) return { allowed: false, authority, reason: 'Daily action count exceeds delegated authority.' }
  if (authority.allowedChannels.length > 0 && input.channel && !authority.allowedChannels.includes(input.channel)) return { allowed: false, authority, reason: 'Requested channel is outside delegated authority.' }
  return { allowed: true, authority, reason: 'Action is permitted within active delegated authority.' }
}

export async function auditCommercialAction(input: Omit<CommercialAuditRecord, 'auditId' | 'createdAt'> & { auditId?: string }): Promise<CommercialAuditRecord> {
  const audit: CommercialAuditRecord = { ...input, auditId: input.auditId?.trim() || `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, action: input.action.trim(), actor: input.actor.trim(), reason: input.reason.trim(), createdAt: new Date().toISOString() }
  await db.memory.create({ data: { key: `audit:${input.tenantId}:${audit.auditId}`, category: COMMERCIAL_CATEGORIES.audit, value: JSON.stringify(audit) } })
  return audit
}

export async function getCommercialControlPlaneSnapshot(tenantId?: string): Promise<CommercialControlPlaneSnapshot> {
  const categories = await Promise.all(Object.values(COMMERCIAL_CATEGORIES).map(async (category) => ({ category, records: await db.memory.findMany({ where: { category }, take: 5000 }) })))
  const parsed = new Map<string, Record<string, unknown>[]>()
  for (const group of categories) parsed.set(group.category, group.records.map((record) => { try { return JSON.parse(record.value) as Record<string, unknown> } catch { return null } }).filter((item): item is Record<string, unknown> => !!item))
  const scoped = (category: string) => (parsed.get(category) ?? []).filter((item) => !tenantId || item.tenantId === tenantId)
  const counts = (business: CommercialBusiness) => ({ customers: scoped(COMMERCIAL_CATEGORIES.customer).filter((x) => x.business === business).length, events: scoped(COMMERCIAL_CATEGORIES.event).filter((x) => x.business === business).length, workflows: scoped(COMMERCIAL_CATEGORIES.workflow).filter((x) => x.business === business).length, billing: scoped(COMMERCIAL_CATEGORIES.billing).filter((x) => x.business === business).length, evidence: scoped(COMMERCIAL_CATEGORIES.evidence).filter((x) => x.business === business).length })
  const businesses = Object.fromEntries(COMMERCIAL_BUSINESSES.map((business) => [business, counts(business)])) as CommercialControlPlaneSnapshot['businesses']
  const issues: string[] = []
  const events = scoped(COMMERCIAL_CATEGORIES.event); const workflows = scoped(COMMERCIAL_CATEGORIES.workflow); const customers = scoped(COMMERCIAL_CATEGORIES.customer)
  if (new Set(customers.map((x) => x.customerId)).size !== customers.length) issues.push('Duplicate customer IDs detected.')
  if (new Set(events.map((x) => x.idempotencyKey)).size !== events.length) issues.push('Duplicate event idempotency keys detected.')
  if (new Set(workflows.map((x) => x.idempotencyKey)).size !== workflows.length) issues.push('Duplicate workflow idempotency keys detected.')
  for (const item of scoped(COMMERCIAL_CATEGORIES.credential)) if (typeof item.secretRef === 'string' && /(^sk_|^rk_|^pk_|password=|token=)/i.test(item.secretRef)) issues.push(`Credential ${String(item.credentialId)} appears to contain raw secret material.`)
  return { id: COMMERCIAL_CONTROL_PLANE_ID, version: COMMERCIAL_CONTROL_PLANE_VERSION, tenantCount: scoped(COMMERCIAL_CATEGORIES.tenant).length, customerCount: customers.length, eventCount: events.length, workflowCount: workflows.length, credentialCount: scoped(COMMERCIAL_CATEGORIES.credential).length, billingCount: scoped(COMMERCIAL_CATEGORIES.billing).length, entitlementCount: scoped(COMMERCIAL_CATEGORIES.entitlement).length, evidenceCount: scoped(COMMERCIAL_CATEGORIES.evidence).length, activeAuthorityCount: scoped(COMMERCIAL_CATEGORIES.authority).filter((x) => x.status === 'active' && (!x.expiresAt || new Date(String(x.expiresAt)).getTime() > Date.now())).length, auditCount: scoped(COMMERCIAL_CATEGORIES.audit).length, businesses, integrity: { ok: issues.length === 0, issues } }
}

export function validateCommercialControlPlaneContracts(): string[] {
  const errors: string[] = []
  if (COMMERCIAL_BUSINESSES.length !== 4) errors.push('Commercial taxonomy must contain three venture units plus shared-platform.')
  if (Object.values(COMMERCIAL_CATEGORIES).length !== 10) errors.push('Commercial persistence taxonomy must contain 10 unique categories.')
  if (new Set(Object.values(COMMERCIAL_CATEGORIES)).size !== Object.values(COMMERCIAL_CATEGORIES).length) errors.push('Commercial persistence categories must be unique.')
  if (!['autonomous', 'guardrailed', 'human_approval', 'forbidden'].every((value) => (['autonomous', 'guardrailed', 'human_approval', 'forbidden'] as AuthorityLevel[]).includes(value as AuthorityLevel))) errors.push('Authority taxonomy is invalid.')
  return errors
}
