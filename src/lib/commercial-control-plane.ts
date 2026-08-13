/** Shared commercial control plane for Agent007's three ventures. */
import { db } from './db'

export const COMMERCIAL_CONTROL_PLANE_ID = 'commercial-control-plane'
export const COMMERCIAL_CONTROL_PLANE_VERSION = 1

export type CommercialBusiness = 'revenue-recovery' | 'operations-kit' | 'career-command' | 'shared-platform'
export type CustomerStatus = 'lead' | 'prospect' | 'customer' | 'inactive' | 'churned'
export type EventStatus = 'accepted' | 'processed' | 'failed' | 'ignored'
export type WorkflowStatus = 'queued' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled'
export type CredentialStatus = 'pending' | 'connected' | 'expired' | 'revoked' | 'error'
export type BillingStatus = 'pending' | 'paid' | 'failed' | 'refunded' | 'cancelled'
export type AuthorityLevel = 'autonomous' | 'guardrailed' | 'human_approval' | 'forbidden'

export interface CommercialTenant {
  tenantId: string
  ownerUserId: string
  name: string
  status: 'active' | 'suspended' | 'archived'
  businesses: CommercialBusiness[]
  createdAt: string
  updatedAt: string
}
export interface CommercialCustomer {
  customerId: string
  tenantId: string
  business: CommercialBusiness
  name: string
  normalizedEmail: string | null
  phone: string | null
  company: string | null
  status: CustomerStatus
  source: string | null
  value: number
  tags: string[]
  createdAt: string
  updatedAt: string
}
export interface CommercialEvent {
  eventId: string
  tenantId: string
  business: CommercialBusiness
  type: string
  source: string
  entityType: string
  entityId: string | null
  payload: Record<string, unknown>
  occurredAt: string
  acceptedAt: string
  status: EventStatus
  idempotencyKey: string
}
export interface CommercialWorkflow {
  workflowId: string
  tenantId: string
  business: CommercialBusiness
  workflowType: string
  status: WorkflowStatus
  input: Record<string, unknown>
  output: Record<string, unknown> | null
  retryCount: number
  maxRetries: number
  nextRunAt: string | null
  idempotencyKey: string
  createdAt: string
  updatedAt: string
}
export interface CredentialReference {
  credentialId: string
  tenantId: string
  business: CommercialBusiness
  provider: string
  externalAccountId: string | null
  scopes: string[]
  status: CredentialStatus
  secretRef: string
  createdAt: string
  updatedAt: string
  lastValidatedAt: string | null
}
export interface BillingRecord {
  billingId: string
  tenantId: string
  business: CommercialBusiness
  provider: string
  providerObjectId: string | null
  customerId: string | null
  amount: number
  currency: string
  status: BillingStatus
  product: string
  idempotencyKey: string
  createdAt: string
  updatedAt: string
}
export interface Entitlement {
  entitlementId: string
  tenantId: string
  business: CommercialBusiness
  product: string
  subjectId: string
  status: 'active' | 'paused' | 'expired' | 'revoked'
  limits: Record<string, number>
  validUntil: string | null
  createdAt: string
  updatedAt: string
}
export interface CommercialEvidence {
  evidenceId: string
  tenantId: string
  business: CommercialBusiness
  source: string
  type: 'market' | 'customer' | 'usage' | 'payment' | 'analytics' | 'operations' | 'support' | 'system'
  statement: string
  confidence: number
  verified: boolean
  observedAt: string
  entityType: string | null
  entityId: string | null
  createdAt: string
}
export interface DelegatedAuthority {
  authorityId: string
  tenantId: string
  business: CommercialBusiness
  action: string
  level: AuthorityLevel
  maxSpend: number | null
  maxDailyCount: number | null
  allowedChannels: string[]
  approvedByUserId: string
  approvedAt: string
  expiresAt: string | null
  status: 'active' | 'expired' | 'revoked'
}
export interface CommercialAuditRecord {
  auditId: string
  tenantId: string
  business: CommercialBusiness
  action: string
  actor: string
  entityType: string
  entityId: string | null
  allowed: boolean
  reason: string
  metadata: Record<string, unknown>
  createdAt: string
}

export const COMMERCIAL_CATEGORIES = Object.freeze({
  tenant: 'commercial_tenant', customer: 'commercial_customer', event: 'commercial_event', workflow: 'commercial_workflow',
  credential: 'commercial_credential', billing: 'commercial_billing', entitlement: 'commercial_entitlement', evidence: 'commercial_evidence',
  authority: 'commercial_delegated_authority', audit: 'commercial_audit',
})

export const COMMERCIAL_BUSINESSES: readonly CommercialBusiness[] = ['revenue-recovery', 'operations-kit', 'career-command', 'shared-platform']

function clean(value: string): string { return value.trim().replace(/\s+/g, ' ') }
function now(): string { return new Date().toISOString() }
function key(kind: string, tenantId: string, id: string): string { return `${kind}:${tenantId}:${id}` }
function clampConfidence(value: number): number { return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0 }
function normalizeEmail(value?: string | null): string | null { const v = value?.trim().toLowerCase() ?? ''; return v.includes('@') ? v : null }

export function isCommercialBusiness(value: unknown): value is CommercialBusiness { return typeof value === 'string' && COMMERCIAL_BUSINESSES.includes(value as CommercialBusiness) }

async function readCategory<T>(category: string, limit = 1000): Promise<T[]> {
  const records = await db.memory.findMany({ where: { category }, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(limit, 1), 5000) })
  return records.map((record) => { try { return JSON.parse(record.value) as T } catch { return null } }).filter((value): value is T => value !== null)
}

async function writeIdempotent<T>(recordKey: string, category: string, value: T): Promise<{ created: boolean; value: T }> {
  const existing = await db.memory.findUnique({ where: { key: recordKey } })
  if (existing) {
    try { return { created: false, value: JSON.parse(existing.value) as T } } catch { throw new Error(`Corrupt commercial record: ${recordKey}`) }
  }
  await db.memory.create({ data: { key: recordKey, category, value: JSON.stringify(value) } })
  return { created: true, value }
}

export async function ensureCommercialTenant(ownerUserId: string, name = 'Agent007 Commercial Portfolio'): Promise<CommercialTenant> {
  const owner = clean(ownerUserId)
  if (!owner) throw new Error('ownerUserId is required.')
  const tenantId = `tenant_${owner}`
  const recordKey = key('tenant', tenantId, 'primary')
  const existing = await db.memory.findUnique({ where: { key: recordKey } })
  if (existing) return JSON.parse(existing.value) as CommercialTenant
  const timestamp = now()
  const tenant: CommercialTenant = { tenantId, ownerUserId: owner, name: clean(name) || 'Agent007 Commercial Portfolio', status: 'active', businesses: [...COMMERCIAL_BUSINESSES], createdAt: timestamp, updatedAt: timestamp }
  await db.memory.create({ data: { key: recordKey, category: COMMERCIAL_CATEGORIES.tenant, value: JSON.stringify(tenant) } })
  return tenant
}

export async function getCommercialTenant(tenantId: string): Promise<CommercialTenant | null> {
  const record = await db.memory.findUnique({ where: { key: key('tenant', tenantId, 'primary') } })
  return record ? (JSON.parse(record.value) as CommercialTenant) : null
}

export async function createCommercialCustomer(input: Omit<CommercialCustomer, 'customerId' | 'createdAt' | 'updatedAt' | 'normalizedEmail'> & { customerId?: string; normalizedEmail?: string | null }): Promise<{ created: boolean; customer: CommercialCustomer }> {
  if (!input.tenantId.trim() || !isCommercialBusiness(input.business)) throw new Error('Valid tenantId and business are required.')
  const name = clean(input.name)
  if (!name) throw new Error('Customer name is required.')
  const email = normalizeEmail(input.normalizedEmail)
  const existing = (await readCategory<CommercialCustomer>(COMMERCIAL_CATEGORIES.customer)).find((item) => item.tenantId === input.tenantId && item.business === input.business && email && item.normalizedEmail === email)
  if (existing) return { created: false, customer: existing }
  const timestamp = now()
  const customer: CommercialCustomer = { customerId: input.customerId?.trim() || `cust_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, tenantId: input.tenantId, business: input.business, name, normalizedEmail: email, phone: input.phone?.trim() || null, company: input.company?.trim() || null, status: input.status, source: input.source?.trim() || null, value: Number.isFinite(input.value) ? Math.max(0, input.value) : 0, tags: [...new Set((input.tags ?? []).map(clean).filter(Boolean))], createdAt: timestamp, updatedAt: timestamp }
  const result = await writeIdempotent(key('customer', input.tenantId, customer.customerId), COMMERCIAL_CATEGORIES.customer, customer)
  return { created: result.created, customer: result.value }
}

export async function listCommercialCustomers(tenantId: string, business?: CommercialBusiness): Promise<CommercialCustomer[]> {
  return (await readCategory<CommercialCustomer>(COMMERCIAL_CATEGORIES.customer)).filter((item) => item.tenantId === tenantId && (!business || item.business === business))
}

export async function recordCommercialEvent(input: Omit<CommercialEvent, 'eventId' | 'acceptedAt' | 'status'> & { eventId?: string }): Promise<{ created: boolean; event: CommercialEvent }> {
  const idempotencyKey = clean(input.idempotencyKey)
  if (!input.tenantId.trim() || !isCommercialBusiness(input.business) || !idempotencyKey) throw new Error('tenantId, business, and idempotencyKey are required.')
  if (!clean(input.type) || !clean(input.source) || !clean(input.entityType)) throw new Error('type, source, and entityType are required.')
  const event: CommercialEvent = { ...input, eventId: input.eventId?.trim() || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, type: clean(input.type), source: clean(input.source), entityType: clean(input.entityType), entityId: input.entityId ?? null, payload: input.payload ?? {}, acceptedAt: now(), status: 'accepted' }
  const result = await writeIdempotent(key('event', input.tenantId, idempotencyKey), COMMERCIAL_CATEGORIES.event, event)
  return { created: result.created, event: result.value }
}

export async function listCommercialEvents(tenantId: string, business?: CommercialBusiness, limit = 100): Promise<CommercialEvent[]> {
  return (await readCategory<CommercialEvent>(COMMERCIAL_CATEGORIES.event, limit)).filter((item) => item.tenantId === tenantId && (!business || item.business === business))
}

export async function createCommercialWorkflow(input: Omit<CommercialWorkflow, 'workflowId' | 'retryCount' | 'createdAt' | 'updatedAt' | 'status' | 'output'> & { workflowId?: string; status?: WorkflowStatus; retryCount?: number }): Promise<{ created: boolean; workflow: CommercialWorkflow }> {
  if (!input.tenantId.trim() || !isCommercialBusiness(input.business)) throw new Error('Valid tenantId and business are required.')
  if (!clean(input.workflowType) || !clean(input.idempotencyKey)) throw new Error('workflowType and idempotencyKey are required.')
  const timestamp = now()
  const workflow: CommercialWorkflow = { workflowId: input.workflowId?.trim() || `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, tenantId: input.tenantId, business: input.business, workflowType: clean(input.workflowType), status: input.status ?? 'queued', input: input.input ?? {}, output: null, retryCount: Math.max(0, input.retryCount ?? 0), maxRetries: Math.min(10, Math.max(0, input.maxRetries)), nextRunAt: input.nextRunAt ?? timestamp, idempotencyKey: clean(input.idempotencyKey), createdAt: timestamp, updatedAt: timestamp }
  const result = await writeIdempotent(key('workflow', input.tenantId, workflow.idempotencyKey), COMMERCIAL_CATEGORIES.workflow, workflow)
  return { created: result.created, workflow: result.value }
}

export async function getCommercialWorkflows(tenantId: string, business?: CommercialBusiness, limit = 100): Promise<CommercialWorkflow[]> {
  return (await readCategory<CommercialWorkflow>(COMMERCIAL_CATEGORIES.workflow, limit)).filter((item) => item.tenantId === tenantId && (!business || item.business === business))
}

export async function registerCredentialReference(input: Omit<CredentialReference, 'credentialId' | 'createdAt' | 'updatedAt' | 'lastValidatedAt' | 'status'> & { credentialId?: string; status?: CredentialStatus; lastValidatedAt?: string | null }): Promise<{ created: boolean; credential: CredentialReference }> {
  if (!input.tenantId.trim() || !isCommercialBusiness(input.business) || !clean(input.provider) || !clean(input.secretRef)) throw new Error('tenantId, business, provider, and secretRef are required.')
  if (/^\s*(sk_|rk_|pk_|token_|password=)/i.test(input.secretRef)) throw new Error('Raw credential material is not allowed; use an opaque secretRef.')
  const timestamp = now()
  const credential: CredentialReference = { credentialId: input.credentialId?.trim() || `cred_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, tenantId: input.tenantId, business: input.business, provider: clean(input.provider), externalAccountId: input.externalAccountId?.trim() || null, scopes: [...new Set((input.scopes ?? []).map(clean).filter(Boolean))], status: input.status ?? 'pending', secretRef: clean(input.secretRef), createdAt: timestamp, updatedAt: timestamp, lastValidatedAt: input.lastValidatedAt ?? null }
  const identity = `${credential.provider}:${credential.externalAccountId ?? credential.credentialId}`
  const result = await writeIdempotent(key('credential', input.tenantId, identity), COMMERCIAL_CATEGORIES.credential, credential)
  return { created: result.created, credential: result.value }
}
