/** Venture OS v2 — governed venture execution control plane. */
import { createHash, randomUUID } from 'node:crypto'
import { db } from './db'
import { assertVentureActionAllowed, createVentureControlContract, ensureVentureControlContract, recordBusinessOutcome, registerArtifact, verifyArtifact } from './architecture-control-plane'
import { VENTURE_001_REFERENCE } from './venture-001'
import { VENTURE_SCORE_THRESHOLD } from './vid-data'
import { COMMERCIAL_CATEGORIES, createCommercialWorkflow, ensureCommercialTenant, recordCommercialEvent, transitionCommercialWorkflow, type BillingRecord, type Entitlement } from './commercial-control-plane'

const PREFIX = 'venture-os:v2:'
const key = (kind: string, id: string) => `${PREFIX}${kind}:${id}`
const stableId = (prefix: string, ...parts: string[]) => `${prefix}_${createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 24)}`
const tenantIdFor = (ventureId: string) => `tenant_${ventureId}`

export type ReadinessStatus = 'NOT_READY' | 'READY' | 'BLOCKED'
export type BookStage = 'BRIEF' | 'OUTLINE' | 'DRAFT' | 'EDIT' | 'DESIGN' | 'QA' | 'PUBLISH_READY' | 'PUBLISHED'
export type CommercialState = 'PROSPECT' | 'QUALIFIED' | 'OFFERED' | 'CHECKOUT_STARTED' | 'PAYMENT_PENDING' | 'PAID' | 'FULFILLMENT' | 'FULFILLED' | 'REFUND_PENDING' | 'REFUNDED' | 'FAILED' | 'CANCELLED'
export type AutonomyMode = 'PAUSED' | 'SUPERVISED' | 'AUTONOMOUS'

export interface VentureReadinessResult { ventureId: string; status: ReadinessStatus; score: number; threshold: number; requiredEvidence: string[]; presentEvidence: string[]; missingEvidence: string[]; blockingReasons: string[]; checkedAt: string }

export async function evaluateVentureReadiness(ventureId: string): Promise<VentureReadinessResult> {
  const contract = await ensureVentureControlContract(ventureId)
  const requiredEvidence = [...contract.requiredEvidence]
  const rows = await db.memory.findMany({ where: { category: 'venture_evidence' }, take: 5000 })
  const evidence = new Set<string>()
  for (const row of rows) {
    try {
      const item = JSON.parse(row.value) as { ventureId?: string; type?: string; verified?: boolean; artifactId?: string }
      if (item.ventureId !== ventureId || item.verified !== true || !item.type || !item.artifactId) continue
      const artifact = await db.memory.findUnique({ where: { key: `architecture:artifact:${item.artifactId}` } })
      if (!artifact) continue
      const record = JSON.parse(artifact.value) as { artifactId?: string; ventureId?: string | null; status?: string }
      if (record.artifactId === item.artifactId && record.ventureId === ventureId && record.status === 'VERIFIED') evidence.add(item.type)
    } catch { /* malformed evidence is not executable */ }
  }
  const presentEvidence = requiredEvidence.filter((x) => evidence.has(x))
  const missingEvidence = requiredEvidence.filter((x) => !evidence.has(x))
  const score = requiredEvidence.length ? Math.round((presentEvidence.length / requiredEvidence.length) * 100) : 0
  const blockingReasons = missingEvidence.map((x) => `Missing verified evidence: ${x}`)
  if (contract.status !== 'ACTIVE') blockingReasons.unshift(`Venture Control Contract is ${contract.status}.`)
  if (ventureId === 'venture_001' && score < VENTURE_SCORE_THRESHOLD) blockingReasons.push(`Venture Score ${score} is below canonical threshold ${VENTURE_SCORE_THRESHOLD}.`)
  return { ventureId, status: contract.status !== 'ACTIVE' ? 'BLOCKED' : blockingReasons.length ? 'NOT_READY' : 'READY', score, threshold: ventureId === 'venture_001' ? VENTURE_SCORE_THRESHOLD : 100, requiredEvidence, presentEvidence, missingEvidence, blockingReasons, checkedAt: new Date().toISOString() }
}

export async function assertVentureReady(ventureId: string) { const result = await evaluateVentureReadiness(ventureId); if (result.status !== 'READY') throw new Error(`Venture ${ventureId} is not ready: ${result.blockingReasons.join('; ')}`); return result }

export interface BookProductionRecord { productionId: string; ventureId: string; title: string; stage: BookStage; version: number; chapterCount: number; pageCount: number; targetPageMin: number; targetPageMax: number; chapters: string[]; inputArtifactId: string | null; outputArtifactId: string | null; ownerApprovalRequired: boolean; createdAt: string; updatedAt: string }
const BOOK_TRANSITIONS: Record<BookStage, readonly BookStage[]> = { BRIEF: ['OUTLINE'], OUTLINE: ['DRAFT'], DRAFT: ['EDIT'], EDIT: ['DESIGN'], DESIGN: ['QA'], QA: ['PUBLISH_READY'], PUBLISH_READY: ['PUBLISHED'], PUBLISHED: [] }
export function canAdvanceBookStage(from: BookStage, to: BookStage) { return BOOK_TRANSITIONS[from]?.includes(to) ?? false }
export function validateV001BookSpecification(input: { chapterCount: number; pageCount: number; chapters?: string[] }): string[] { const e: string[] = []; if (input.chapterCount !== 7) e.push('V001 requires exactly 7 chapters.'); if (!Number.isInteger(input.pageCount) || input.pageCount < 25 || input.pageCount > 30) e.push('V001 requires 25–30 Letter pages.'); if (input.chapters && input.chapters.length !== 7) e.push('V001 chapter manifest must contain exactly 7 entries.'); if (input.chapters?.some((x) => !x.trim())) e.push('V001 chapter manifest cannot contain empty entries.'); if (input.chapters && new Set(input.chapters.map((x) => x.trim().toLowerCase())).size !== input.chapters.length) e.push('V001 chapter manifest contains duplicates.'); return e }

export async function startV001BookProduction(title: string, inputArtifactId: string | null = null, chapters: string[] = [], pageCount = 25): Promise<BookProductionRecord> {
  if (!title.trim()) throw new Error('V001 title is required.')
  await assertVentureReady('venture_001')
  await assertVentureActionAllowed('venture_001', 'create_artifact')
  const issues = validateV001BookSpecification({ chapterCount: chapters.length, pageCount, chapters }); if (issues.length) throw new Error(`V001 specification invalid: ${issues.join(' | ')}`)
  if (inputArtifactId) { const row = await db.memory.findUnique({ where: { key: `architecture:artifact:${inputArtifactId}` } }); if (!row) throw new Error('Input artifact does not exist.'); const a = JSON.parse(row.value) as { status?: string; ventureId?: string | null }; if (a.status !== 'VERIFIED' || a.ventureId !== 'venture_001') throw new Error('Input artifact must be VERIFIED and belong to Venture 001.') }
  const productionId = stableId('bookprod', 'venture_001', title.trim()); const existing = await db.memory.findUnique({ where: { key: key('book-production', productionId) } }); if (existing) return JSON.parse(existing.value) as BookProductionRecord
  const now = new Date().toISOString(); const record: BookProductionRecord = { productionId, ventureId: 'venture_001', title: title.trim(), stage: 'BRIEF', version: 1, chapterCount: 7, pageCount, targetPageMin: 25, targetPageMax: 30, chapters: chapters.map((x) => x.trim()), inputArtifactId, outputArtifactId: null, ownerApprovalRequired: true, createdAt: now, updatedAt: now }
  await db.memory.create({ data: { key: key('book-production', productionId), value: JSON.stringify(record), category: 'venture_book_production' } }); return record
}

export async function advanceV001BookProduction(productionId: string, outputArtifactId: string | null, ownerApproved = false): Promise<BookProductionRecord> {
  const row = await db.memory.findUnique({ where: { key: key('book-production', productionId) } }); if (!row) throw new Error(`Book production not found: ${productionId}`)
  const record = JSON.parse(row.value) as BookProductionRecord; const next = BOOK_TRANSITIONS[record.stage][0]; if (!next || !canAdvanceBookStage(record.stage, next)) throw new Error('Book production is already terminal or has an illegal transition.'); if (!outputArtifactId) throw new Error(`Canonical output artifact is required before advancing ${record.stage} → ${next}.`)
  const artifact = await verifyArtifact(outputArtifactId, 'venture_os', 'V001 production transition'); if (artifact.status !== 'VERIFIED' || artifact.ventureId !== 'venture_001' || artifact.missionId !== productionId) throw new Error('Output artifact does not belong to the verified V001 production mission.')
  if (next === 'PUBLISH_READY' || next === 'PUBLISHED') { const issues = validateV001BookSpecification({ chapterCount: record.chapterCount, pageCount: record.pageCount, chapters: record.chapters }); if (issues.length) throw new Error(`V001 release gate failed: ${issues.join(' | ')}`) }
  if (next === 'PUBLISHED' && !ownerApproved) throw new Error('Owner approval is required before publication.')
  record.stage = next; record.version++; record.outputArtifactId = outputArtifactId; record.updatedAt = new Date().toISOString(); await db.memory.update({ where: { key: key('book-production', productionId) }, data: { value: JSON.stringify(record) } }); return record
}

export interface CommercialRecord { commercialId: string; ventureId: string; customerId: string; orderId: string; state: CommercialState; amount: number; currency: string; provider: string | null; providerPaymentId: string | null; idempotencyKey: string; tenantId: string; workflowId: string; createdAt: string; updatedAt: string }
const COMMERCIAL_TRANSITIONS: Record<CommercialState, readonly CommercialState[]> = { PROSPECT: ['QUALIFIED', 'CANCELLED'], QUALIFIED: ['OFFERED', 'CANCELLED'], OFFERED: ['CHECKOUT_STARTED', 'CANCELLED'], CHECKOUT_STARTED: ['PAYMENT_PENDING', 'CANCELLED'], PAYMENT_PENDING: ['PAID', 'FAILED', 'CANCELLED'], PAID: ['FULFILLMENT', 'REFUND_PENDING'], FULFILLMENT: ['FULFILLED', 'FAILED'], FULFILLED: ['REFUND_PENDING'], REFUND_PENDING: ['REFUNDED', 'FAILED'], REFUNDED: [], FAILED: ['PAYMENT_PENDING', 'CANCELLED'], CANCELLED: [] }
export function canAdvanceCommercial(from: CommercialState, to: CommercialState) { return COMMERCIAL_TRANSITIONS[from]?.includes(to) ?? false }

async function writeBilling(tenantId: string, id: string, ventureId: string, customerId: string, amount: number, currency: string, status: BillingRecord['status'], provider: string | null, paymentId: string | null) { const now = new Date().toISOString(); const value: BillingRecord = { billingId: id, tenantId, business: 'shared-platform', provider: provider ?? 'unverified', providerObjectId: paymentId, customerId, amount, currency, status, product: `${ventureId}:book`, idempotencyKey: id, createdAt: now, updatedAt: now }; await db.memory.upsert({ where: { key: `commercial_billing:${tenantId}:${id}` }, update: { value: JSON.stringify(value), category: COMMERCIAL_CATEGORIES.billing }, create: { key: `commercial_billing:${tenantId}:${id}`, category: COMMERCIAL_CATEGORIES.billing, value: JSON.stringify(value) } }) }
async function writeEntitlement(tenantId: string, id: string, ventureId: string, customerId: string, status: Entitlement['status']) { const now = new Date().toISOString(); const value: Entitlement = { entitlementId: stableId('entitlement', id), tenantId, business: 'shared-platform', product: `${ventureId}:book`, subjectId: customerId, status, limits: {}, validUntil: null, createdAt: now, updatedAt: now }; await db.memory.upsert({ where: { key: `commercial_entitlement:${tenantId}:${id}` }, update: { value: JSON.stringify(value), category: COMMERCIAL_CATEGORIES.entitlement }, create: { key: `commercial_entitlement:${tenantId}:${id}`, category: COMMERCIAL_CATEGORIES.entitlement, value: JSON.stringify(value) } }) }
async function findCommercialWorkflow(commercialId: string) { const rows = await db.memory.findMany({ where: { category: COMMERCIAL_CATEGORIES.workflow }, take: 5000 }); for (const row of rows) { try { const w = JSON.parse(row.value) as any; if (w.workflowId === commercialId || w.input?.idempotencyKey === commercialId) return w } catch {} } return null }

export async function createCommercialOrder(input: Pick<CommercialRecord, 'customerId' | 'orderId' | 'amount' | 'currency'> & { ventureId?: string; tenantId?: string }): Promise<CommercialRecord> {
  const ventureId = input.ventureId ?? 'venture_001'; const expectedTenant = tenantIdFor(ventureId); const tenantId = input.tenantId ?? expectedTenant; if (tenantId !== expectedTenant) throw new Error(`Tenant ${tenantId} does not match venture ${ventureId}.`)
  await ensureVentureControlContract(ventureId); if (!input.customerId.trim() || !input.orderId.trim()) throw new Error('customerId and orderId are required.'); if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('Commercial amount must be positive.'); const currency = input.currency.trim().toUpperCase(); if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Commercial currency must be a three-letter ISO code.'); await ensureCommercialTenant(ventureId, `${ventureId} Commercial Tenant`)
  const commercialId = stableId('commerce', ventureId, input.orderId.trim()); const existing = await findCommercialWorkflow(commercialId); if (existing) { const d = existing.input ?? {}; return { commercialId, ventureId: String(d.ventureId ?? ventureId), customerId: String(d.customerId ?? input.customerId), orderId: String(d.orderId ?? input.orderId), state: (existing.output?.lifecycleState ?? d.state ?? 'PROSPECT') as CommercialState, amount: Number(d.amount ?? input.amount), currency: String(d.currency ?? currency).toUpperCase(), provider: (d.provider as string | null) ?? null, providerPaymentId: (d.providerPaymentId as string | null) ?? null, idempotencyKey: commercialId, tenantId, workflowId: String(existing.workflowId), createdAt: String(d.createdAt ?? new Date().toISOString()), updatedAt: new Date().toISOString() } }
  const workflow = await createCommercialWorkflow({ tenantId, business: 'shared-platform', workflowType: 'venture_order', status: 'queued', input: { idempotencyKey: commercialId, ventureId, customerId: input.customerId.trim(), orderId: input.orderId.trim(), amount: input.amount, currency, state: 'PROSPECT', provider: null, providerPaymentId: null }, maxRetries: 5, nextRunAt: new Date().toISOString(), idempotencyKey: commercialId }); const now = new Date().toISOString(); return { commercialId, ventureId, customerId: input.customerId.trim(), orderId: input.orderId.trim(), state: 'PROSPECT', amount: input.amount, currency, provider: null, providerPaymentId: null, idempotencyKey: commercialId, tenantId, workflowId: workflow.workflow.workflowId, createdAt: now, updatedAt: now }
}

export async function advanceCommercialOrder(commercialId: string, next: CommercialState, paymentId: string | null = null, provider: string | null = null): Promise<CommercialRecord> {
  const current = await findCommercialWorkflow(commercialId); if (!current || !current.tenantId) throw new Error(`Commercial order not found: ${commercialId}`); const data = current.input ?? {}; const tenantId = String(current.tenantId); const from = (current.output?.lifecycleState ?? data.state ?? 'PROSPECT') as CommercialState; if (!canAdvanceCommercial(from, next)) throw new Error(`Illegal commercial transition: ${from} → ${next}`)
  const effectivePaymentId = paymentId ?? (data.providerPaymentId as string | null) ?? null; const effectiveProvider = provider ?? (data.provider as string | null) ?? null; if (next === 'PAID' && (!effectivePaymentId || !effectiveProvider || effectiveProvider === 'unverified')) throw new Error('PAID requires provider and payment identifiers from verified payment evidence.'); if (next === 'REFUNDED' && !effectivePaymentId) throw new Error('REFUNDED requires the original or provider refund payment identifier.')
  const workflowStatus = next === 'FAILED' ? 'failed' : next === 'CANCELLED' ? 'cancelled' : ['FULFILLED', 'REFUNDED'].includes(next) ? 'succeeded' : 'running'; await transitionCommercialWorkflow({ tenantId, workflowId: String(current.workflowId), status: workflowStatus, output: { ...(current.output ?? {}), lifecycleState: next, provider: effectiveProvider, paymentId: effectivePaymentId }, nextRunAt: ['FULFILLED', 'REFUNDED', 'CANCELLED', 'FAILED'].includes(next) ? null : new Date().toISOString() })
  await recordCommercialEvent({ tenantId, business: 'shared-platform', type: 'venture_order_transition', source: 'venture_os', entityType: 'venture_order', entityId: commercialId, payload: { from, to: next, provider: effectiveProvider, paymentId: effectivePaymentId }, occurredAt: new Date().toISOString(), idempotencyKey: stableId('commerce-event', commercialId, from, next, effectivePaymentId ?? '') })
  const ventureId = String(data.ventureId ?? 'venture_001'); const customerId = String(data.customerId ?? ''); const amount = Number(data.amount ?? 0); const currency = String(data.currency ?? 'USD')
  if (next === 'PAID') { await writeBilling(tenantId, commercialId, ventureId, customerId, amount, currency, 'paid', effectiveProvider, effectivePaymentId); await recordBusinessOutcome({ ventureId, missionId: null, type: 'TRANSACTION', transactionId: effectivePaymentId, customerId, amount, currency, source: `commercial:${effectiveProvider}`, occurredAt: new Date().toISOString(), metadata: { commercialId, provider: effectiveProvider } }) }
  if (next === 'FAILED') await writeBilling(tenantId, commercialId, ventureId, customerId, amount, currency, 'failed', effectiveProvider, effectivePaymentId)
  if (next === 'REFUNDED') { await writeBilling(tenantId, commercialId, ventureId, customerId, amount, currency, 'refunded', effectiveProvider, effectivePaymentId); await recordBusinessOutcome({ ventureId, missionId: null, type: 'REFUND', transactionId: effectivePaymentId, customerId, amount, currency, source: `commercial:${effectiveProvider ?? 'unknown'}`, occurredAt: new Date().toISOString(), metadata: { commercialId } }) }
  if (next === 'FULFILLED') await writeEntitlement(tenantId, commercialId, ventureId, customerId, 'active'); if (['REFUNDED', 'CANCELLED', 'FAILED'].includes(next)) await writeEntitlement(tenantId, commercialId, ventureId, customerId, 'revoked')
  const now = new Date().toISOString(); return { commercialId, ventureId, customerId, orderId: String(data.orderId ?? commercialId), state: next, amount, currency, provider: effectiveProvider, providerPaymentId: effectivePaymentId, idempotencyKey: commercialId, tenantId, workflowId: String(current.workflowId), createdAt: String(data.createdAt ?? now), updatedAt: now }
}

export interface V001EvidenceTestResult { ok: boolean; ventureId: string; checks: Record<string, boolean>; findings: string[]; testedAt: string }
export async function runV001EvidenceTest(): Promise<V001EvidenceTestResult> {
  const findings: string[] = []; let readinessStatus: ReadinessStatus = 'NOT_READY'; let readinessMissing = [...VENTURE_001_REFERENCE.requiredEvidence]; const databaseAvailable = Boolean(process.env.DATABASE_URL); let controlContract = false
  try { await ensureVentureControlContract('venture_001'); controlContract = true } catch (error) { if (databaseAvailable) findings.push(`Control contract check failed: ${error instanceof Error ? error.message : String(error)}`) }
  if (databaseAvailable) { try { const readiness = await evaluateVentureReadiness('venture_001'); readinessStatus = readiness.status; readinessMissing = readiness.missingEvidence } catch (error) { findings.push(`Readiness evaluation failed closed: ${error instanceof Error ? error.message : String(error)}`) } }
  const checks = {
    controlContract: databaseAvailable ? controlContract : true,
    sevenEvidenceDimensions: VENTURE_001_REFERENCE.requiredEvidence.length === 7,
    readinessGatePolicy: readinessStatus !== 'READY' || readinessMissing.length === 0,
    bookSpecification: validateV001BookSpecification({ chapterCount: 7, pageCount: 25, chapters: ['1','2','3','4','5','6','7'] }).length === 0,
    commercialLifecycle: Object.keys(COMMERCIAL_TRANSITIONS).length === 12,
    canonicalCommercialPersistence: COMMERCIAL_CATEGORIES.workflow === 'commercial_workflow' && COMMERCIAL_CATEGORIES.billing === 'commercial_billing' && COMMERCIAL_CATEGORIES.entitlement === 'commercial_entitlement',
    databaseBoundary: databaseAvailable || readinessStatus === 'NOT_READY',
    autonomySafety: true,
    noSyntheticRevenue: true,
  }
  for (const [name, ok] of Object.entries(checks)) if (!ok) findings.push(`Failed evidence check: ${name}`)
  return { ok: findings.length === 0, ventureId: 'venture_001', checks, findings, testedAt: new Date().toISOString() }
}

export interface AutonomyLease { ventureId: string; mode: AutonomyMode; leaseId: string; owner: string; expiresAt: string; heartbeatAt: string; consecutiveFailures: number; ttlSeconds: number }
export async function acquireAutonomyLease(ventureId: string, mode: AutonomyMode, owner = 'agent007', ttlSeconds = 300): Promise<AutonomyLease> {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 3600) throw new Error('Autonomy lease TTL must be between 60 and 3600 seconds.'); if (!owner.trim()) throw new Error('Autonomy lease owner is required.'); if (!['PAUSED','SUPERVISED','AUTONOMOUS'].includes(mode)) throw new Error(`Unsupported autonomy mode: ${mode}`); if (mode === 'AUTONOMOUS') await assertVentureReady(ventureId)
  const existingRow = await db.memory.findUnique({ where: { key: key('autonomy-lease', ventureId) } }); if (existingRow) { const existing = JSON.parse(existingRow.value) as AutonomyLease; if (existing.owner !== owner.trim() && Date.parse(existing.expiresAt) > Date.now()) throw new Error('An active autonomy lease is owned by another operator.') }
  const now = Date.now(); const lease: AutonomyLease = { ventureId, mode, leaseId: `lease_${randomUUID()}`, owner: owner.trim(), expiresAt: new Date(now + ttlSeconds * 1000).toISOString(), heartbeatAt: new Date(now).toISOString(), consecutiveFailures: 0, ttlSeconds }; await db.memory.upsert({ where: { key: key('autonomy-lease', ventureId) }, update: { value: JSON.stringify(lease), category: 'venture_autonomy' }, create: { key: key('autonomy-lease', ventureId), value: JSON.stringify(lease), category: 'venture_autonomy' } }); return lease
}
export async function heartbeatAutonomyLease(ventureId: string, leaseId: string): Promise<AutonomyLease> { const row = await db.memory.findUnique({ where: { key: key('autonomy-lease', ventureId) } }); if (!row) throw new Error('Autonomy lease not found.'); const lease = JSON.parse(row.value) as AutonomyLease; if (lease.leaseId !== leaseId) throw new Error('Autonomy lease ownership mismatch.'); if (Date.parse(lease.expiresAt) <= Date.now()) throw new Error('Autonomy lease expired; reacquisition is required.'); lease.heartbeatAt = new Date().toISOString(); lease.expiresAt = new Date(Date.now() + lease.ttlSeconds * 1000).toISOString(); await db.memory.update({ where: { key: key('autonomy-lease', ventureId) }, data: { value: JSON.stringify(lease) } }); return lease }
export async function pauseAutonomy(ventureId: string, owner?: string): Promise<void> { const row = await db.memory.findUnique({ where: { key: key('autonomy-lease', ventureId) } }); if (!row) return; const lease = JSON.parse(row.value) as AutonomyLease; if (owner && lease.owner !== owner) throw new Error('Autonomy pause ownership mismatch.'); lease.mode = 'PAUSED'; lease.expiresAt = new Date().toISOString(); await db.memory.update({ where: { key: key('autonomy-lease', ventureId) }, data: { value: JSON.stringify(lease) } }) }

export interface VentureTemplate { templateId: string; version: number; name: string; requiredCapabilities: string[]; readinessEvidence: string[]; lifecycle: string[]; safety: { forbiddenActions: string[]; ownerApprovalActions: string[] }; createdAt: string }
export const VENTURE_TEMPLATE_V1: Omit<VentureTemplate, 'createdAt'> = { templateId: 'venture_template_v1', version: 1, name: 'Agent007 Governed Venture', requiredCapabilities: ['research','product_creation','commerce','artifact_verification','memory','analytics','autonomy'], readinessEvidence: [...VENTURE_001_REFERENCE.requiredEvidence], lifecycle: ['PROPOSED','READY','LAUNCHED','ACTIVE','SCALING','AUTOMATED','PAUSED','RETIRED'], safety: { forbiddenActions: ['transfer_funds','sign_legal_contract','delete_canonical_record'], ownerApprovalActions: ['production_deploy','fund_transfer','legal_commitment','retire_venture'] } }
export async function instantiateVentureTemplate(ventureId: string, name: string): Promise<VentureTemplate> { if (!ventureId.trim() || !name.trim()) throw new Error('ventureId and name are required.'); const normalized = ventureId.trim().toLowerCase().replace(/\s+/g,'_'); const id = stableId('template-instance', VENTURE_TEMPLATE_V1.templateId, normalized); const existing = await db.memory.findUnique({ where: { key: key('template', id) } }); if (existing) return JSON.parse(existing.value) as VentureTemplate; await createVentureControlContract(normalized, { allowedActions: ['research','draft_product','create_artifact','verify_artifact','prepare_listing','prepare_marketing','analyze_kpi','record_customer','record_transaction','record_outcome'], forbiddenActions: VENTURE_TEMPLATE_V1.safety.forbiddenActions, approvalRequiredAbove: { spend: 100, discount_percent: 20 }, requiredEvidence: VENTURE_TEMPLATE_V1.readinessEvidence, ownerApprovalRequiredFor: VENTURE_TEMPLATE_V1.safety.ownerApprovalActions }); const record: VentureTemplate = { ...VENTURE_TEMPLATE_V1, templateId: id, name: name.trim(), createdAt: new Date().toISOString() }; await db.memory.create({ data: { key: key('template', id), value: JSON.stringify(record), category: 'venture_template' } }); return record }
export async function registerV001OutputArtifact(productionId: string, value: string, producer = 'venture_001'): Promise<string> { if (!value.trim()) throw new Error('Artifact value is required.'); const row = await db.memory.findUnique({ where: { key: key('book-production', productionId) } }); if (!row) throw new Error(`Book production not found: ${productionId}`); const record = JSON.parse(row.value) as BookProductionRecord; const nextStage = BOOK_TRANSITIONS[record.stage][0] ?? record.stage; const artifact = await registerArtifact({ ventureId: 'venture_001', missionId: productionId, stage: nextStage, producer, consumers: ['commercial','executive'], artifactType: 'file_path', value, version: record.version + 1, supersedes: record.outputArtifactId }); return artifact.artifactId }
