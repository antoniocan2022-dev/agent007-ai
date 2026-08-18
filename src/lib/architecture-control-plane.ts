import { createHash } from 'node:crypto'
import { db } from './db'
import { isCapabilityRegistered } from './autonomy/capability-registry'

export type AuthorityLevel = 'CEO' | 'VID' | 'LEADER' | 'SPECIALIST' | 'TOOL' | 'UNKNOWN'
export interface DelegationRequest { actorId: string; actorLevel: AuthorityLevel; targetId: string; targetLevel: AuthorityLevel; delegatedBy?: string }

const CEO_IDS = new Set(['ceo', 'agent007', 'super-agent', 'super_agent', 'owner'])
const VID_IDS = new Set(['vid', 'vid_director'])
const LEADERS = new Set(['scout', 'aurora', 'vertex', 'quantum', 'echo', 'forge', 'pulse', 'legal', 'banker', 'hunt', 'cybersecurity_a', 'cybersecurity_r', 'trader', 'revenue', 'external_uptime_monitor', 'qa_monitor'])
const SPECIALISTS = new Set(['quill', 'prism', 'developer'])
const normalizeId = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '_')

export function authorityLevelFor(id: string): AuthorityLevel {
  const normalized = normalizeId(id)
  if (!normalized) return 'UNKNOWN'
  if (CEO_IDS.has(normalized)) return 'CEO'
  if (VID_IDS.has(normalized)) return 'VID'
  if (LEADERS.has(normalized)) return 'LEADER'
  if (SPECIALISTS.has(normalized)) return 'SPECIALIST'
  if (isCapabilityRegistered(normalized)) return 'TOOL'
  return 'UNKNOWN'
}

export function assertDelegationAllowed(request: DelegationRequest): void {
  const actor = normalizeId(request.actorId)
  const target = normalizeId(request.targetId)
  if (!actor || !target) throw new Error('Hierarchy violation: actorId and targetId are required.')
  const actualActorLevel = authorityLevelFor(actor)
  const actualTargetLevel = authorityLevelFor(target)
  if (actualActorLevel === 'UNKNOWN') throw new Error(`Hierarchy violation: unregistered actor identity ${actor}.`)
  if (actualTargetLevel === 'UNKNOWN') throw new Error(`Hierarchy violation: unregistered target identity ${target}.`)
  if (actualActorLevel !== request.actorLevel) throw new Error(`Hierarchy violation: actor identity ${actor} resolves to ${actualActorLevel}, not ${request.actorLevel}.`)
  if (actualTargetLevel !== request.targetLevel) throw new Error(`Hierarchy violation: target identity ${target} resolves to ${actualTargetLevel}, not ${request.targetLevel}.`)
  if (request.actorLevel === 'CEO') { if (request.targetLevel !== 'VID' || !VID_IDS.has(target)) throw new Error(`Hierarchy violation: CEO may delegate only to VID; attempted target=${target}.`); return }
  if (request.actorLevel === 'VID') { if (request.targetLevel !== 'LEADER' || !LEADERS.has(target)) throw new Error(`Hierarchy violation: VID may delegate only to registered leaders; attempted target=${target}.`); return }
  if (request.actorLevel === 'LEADER') { if (request.targetLevel !== 'SPECIALIST' && request.targetLevel !== 'TOOL') throw new Error(`Hierarchy violation: leader ${actor} may delegate only to specialists/tools; attempted target=${target}.`); return }
  throw new Error(`Hierarchy violation: ${request.actorLevel} is not authorized to delegate to ${target}.`)
}

export function hierarchyRoute(actorId: string, targetId: string): { routed: boolean; immediateOwner: string } {
  const actorLevel = authorityLevelFor(actorId)
  const targetLevel = authorityLevelFor(targetId)
  if (actorLevel === 'CEO' && targetLevel === 'LEADER') {
    assertDelegationAllowed({ actorId, actorLevel, targetId: 'vid', targetLevel: 'VID' })
    return { routed: true, immediateOwner: 'vid' }
  }
  assertDelegationAllowed({ actorId, actorLevel, targetId, targetLevel })
  return { routed: false, immediateOwner: normalizeId(targetId) }
}

export type ArtifactStatus = 'PRODUCED' | 'VERIFIED' | 'REJECTED' | 'SUPERSEDED'
export type ArtifactKind = 'url' | 'transaction_id' | 'message_id' | 'file_path' | 'data' | 'none'
export interface ArtifactRecord { artifactId: string; ventureId: string | null; missionId: string | null; stage: string; producer: string; consumers: string[]; artifactType: ArtifactKind; value: string; version: number; status: ArtifactStatus; verifiedAt: string | null; verificationSource: string | null; createdAt: string; supersedes: string | null }
interface ArtifactLedgerEvent { eventId: string; artifactId: string; type: ArtifactStatus; actor: string; timestamp: string; metadata?: Record<string, unknown> }
const stableId = (prefix: string, ...parts: string[]) => `${prefix}_${createHash('sha256').update(parts.map((part) => part.trim()).join('|')).digest('hex').slice(0, 24)}`
const artifactKey = (id: string) => `architecture:artifact:${id}`
const artifactEventKey = (artifactId: string, type: ArtifactStatus, actor: string, metadata = '') => `architecture:artifact:event:${stableId('event', artifactId, type, actor, metadata)}`

export function buildArtifactId(input: Pick<ArtifactRecord, 'ventureId' | 'missionId' | 'stage' | 'artifactType' | 'value'>): string { return stableId('artifact', input.ventureId ?? '', input.missionId ?? '', input.stage, input.artifactType, input.value) }
function validateArtifactInput(input: Omit<ArtifactRecord, 'artifactId' | 'createdAt' | 'status' | 'verifiedAt' | 'verificationSource'>): void {
  if (!input.stage.trim()) throw new Error('Artifact stage is required.')
  if (!input.producer.trim()) throw new Error('Artifact producer is required.')
  if (!input.artifactType) throw new Error('Artifact type is required.')
  if (typeof input.value !== 'string' || !input.value.trim()) throw new Error('Artifact value is required.')
  if (!Number.isInteger(input.version) || input.version < 1) throw new Error('Artifact version must be a positive integer.')
}
function assertArtifactIdentityCompatible(existing: ArtifactRecord, requested: ArtifactRecord): void {
  const fields: Array<keyof ArtifactRecord> = ['ventureId', 'missionId', 'stage', 'producer', 'artifactType', 'value', 'version', 'supersedes']
  for (const field of fields) {
    if (JSON.stringify(existing[field]) !== JSON.stringify(requested[field])) throw new Error(`Artifact identity collision for ${existing.artifactId}: immutable field ${String(field)} differs.`)
  }
}
async function writeArtifactEvent(event: ArtifactLedgerEvent): Promise<void> {
  await db.memory.upsert({ where: { key: event.eventId }, update: { value: JSON.stringify(event), category: 'architecture_artifact_event' }, create: { key: event.eventId, value: JSON.stringify(event), category: 'architecture_artifact_event' } })
}

export async function registerArtifact(input: Omit<ArtifactRecord, 'artifactId' | 'createdAt' | 'status' | 'verifiedAt' | 'verificationSource'> & Partial<Pick<ArtifactRecord, 'artifactId' | 'createdAt'>>): Promise<ArtifactRecord> {
  validateArtifactInput(input)
  const artifactId = input.artifactId ?? buildArtifactId(input)
  const key = artifactKey(artifactId)
  if (input.supersedes && input.supersedes === artifactId) throw new Error('Artifact cannot supersede itself.')
  if (input.supersedes) {
    const predecessor = await getArtifact(input.supersedes)
    if (!predecessor) throw new Error(`Artifact to supersede does not exist: ${input.supersedes}`)
    if (predecessor.status === 'SUPERSEDED') throw new Error(`Artifact is already superseded: ${input.supersedes}`)
  }
  const candidate: ArtifactRecord = {
    artifactId,
    ventureId: input.ventureId ?? null,
    missionId: input.missionId ?? null,
    stage: input.stage.trim(),
    producer: input.producer.trim(),
    consumers: [...new Set((input.consumers ?? []).map((item) => item.trim()).filter(Boolean))],
    artifactType: input.artifactType,
    value: input.value.trim(),
    version: input.version ?? 1,
    status: 'PRODUCED',
    verifiedAt: null,
    verificationSource: null,
    createdAt: input.createdAt ?? new Date().toISOString(),
    supersedes: input.supersedes ?? null,
  }
  const existing = await db.memory.findUnique({ where: { key } })
  if (existing) {
    const record = JSON.parse(existing.value) as ArtifactRecord
    assertArtifactIdentityCompatible(record, candidate)
    return record
  }
  try {
    await db.memory.create({ data: { key, value: JSON.stringify(candidate), category: 'architecture_artifact' } })
  } catch {
    const raced = await db.memory.findUnique({ where: { key } })
    if (!raced) throw new Error(`Artifact ${artifactId} could not be persisted.`)
    const record = JSON.parse(raced.value) as ArtifactRecord
    assertArtifactIdentityCompatible(record, candidate)
    return record
  }
  await writeArtifactEvent({ eventId: artifactEventKey(artifactId, 'PRODUCED', candidate.producer), artifactId, type: 'PRODUCED', actor: candidate.producer, timestamp: candidate.createdAt })
  if (candidate.supersedes) await supersedeArtifact(candidate.supersedes, candidate.producer, artifactId)
  return candidate
}

export async function verifyArtifact(artifactId: string, actor: string, source: string): Promise<ArtifactRecord> {
  if (!actor.trim() || !source.trim()) throw new Error('Artifact verification actor and source are required.')
  const row = await db.memory.findUnique({ where: { key: artifactKey(artifactId) } })
  if (!row) throw new Error(`Artifact not found: ${artifactId}`)
  const record = JSON.parse(row.value) as ArtifactRecord
  if (record.status === 'VERIFIED') return record
  if (record.status === 'REJECTED' || record.status === 'SUPERSEDED') throw new Error(`Artifact cannot be verified from terminal status ${record.status}.`)
  record.status = 'VERIFIED'
  record.verifiedAt = new Date().toISOString()
  record.verificationSource = source.trim()
  await db.memory.update({ where: { key: artifactKey(artifactId) }, data: { value: JSON.stringify(record) } })
  await writeArtifactEvent({ eventId: artifactEventKey(artifactId, 'VERIFIED', actor, source), artifactId, type: 'VERIFIED', actor: actor.trim(), timestamp: record.verifiedAt, metadata: { source: source.trim() } })
  return record
}

export async function rejectArtifact(artifactId: string, actor: string, reason: string): Promise<ArtifactRecord> {
  if (!actor.trim() || !reason.trim()) throw new Error('Artifact rejection actor and reason are required.')
  const row = await db.memory.findUnique({ where: { key: artifactKey(artifactId) } })
  if (!row) throw new Error(`Artifact not found: ${artifactId}`)
  const record = JSON.parse(row.value) as ArtifactRecord
  if (record.status === 'VERIFIED') throw new Error('Verified artifacts cannot be rejected; create a superseding version instead.')
  if (record.status === 'SUPERSEDED') throw new Error('Superseded artifacts cannot be rejected.')
  record.status = 'REJECTED'
  await db.memory.update({ where: { key: artifactKey(artifactId) }, data: { value: JSON.stringify(record) } })
  await writeArtifactEvent({ eventId: artifactEventKey(artifactId, 'REJECTED', actor, reason), artifactId, type: 'REJECTED', actor: actor.trim(), timestamp: new Date().toISOString(), metadata: { reason: reason.trim() } })
  return record
}

export async function supersedeArtifact(artifactId: string, actor: string, successorId: string): Promise<ArtifactRecord> {
  const row = await db.memory.findUnique({ where: { key: artifactKey(artifactId) } })
  if (!row) throw new Error(`Artifact not found: ${artifactId}`)
  const record = JSON.parse(row.value) as ArtifactRecord
  if (record.status === 'SUPERSEDED') return record
  if (!successorId.trim() || successorId === artifactId) throw new Error('A distinct successor artifact id is required.')
  record.status = 'SUPERSEDED'
  await db.memory.update({ where: { key: artifactKey(artifactId) }, data: { value: JSON.stringify(record) } })
  await writeArtifactEvent({ eventId: artifactEventKey(artifactId, 'SUPERSEDED', actor, successorId), artifactId, type: 'SUPERSEDED', actor: actor.trim(), timestamp: new Date().toISOString(), metadata: { successorId } })
  return record
}

export async function getArtifact(artifactId: string): Promise<ArtifactRecord | null> {
  const row = await db.memory.findUnique({ where: { key: artifactKey(artifactId) } })
  return row ? JSON.parse(row.value) as ArtifactRecord : null
}
export async function listArtifacts(input?: { ventureId?: string; missionId?: string; status?: ArtifactStatus; limit?: number }): Promise<ArtifactRecord[]> {
  const rows = await db.memory.findMany({ where: { category: 'architecture_artifact' }, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(input?.limit ?? 100, 1), 5000) })
  return rows.map((row) => { try { return JSON.parse(row.value) as ArtifactRecord } catch { return null } }).filter((artifact): artifact is ArtifactRecord => Boolean(artifact)).filter((artifact) => !input?.ventureId || artifact.ventureId === input.ventureId).filter((artifact) => !input?.missionId || artifact.missionId === input.missionId).filter((artifact) => !input?.status || artifact.status === input.status)
}

export type MissionState = 'PLANNED' | 'IN_PROGRESS' | 'REVIEW' | 'DELIVERED' | 'VERIFIED' | 'OWNER_APPROVAL' | 'COMPLETED' | 'BLOCKED' | 'FAILED'
const TRANSITIONS: Record<MissionState, readonly MissionState[]> = { PLANNED: ['IN_PROGRESS', 'FAILED'], IN_PROGRESS: ['REVIEW', 'FAILED', 'BLOCKED'], REVIEW: ['DELIVERED', 'IN_PROGRESS', 'FAILED', 'BLOCKED'], DELIVERED: ['VERIFIED', 'REVIEW', 'FAILED', 'BLOCKED'], VERIFIED: ['OWNER_APPROVAL', 'FAILED', 'BLOCKED'], OWNER_APPROVAL: ['COMPLETED', 'VERIFIED', 'FAILED'], COMPLETED: [], BLOCKED: ['IN_PROGRESS', 'REVIEW', 'FAILED'], FAILED: [] }
export function canTransitionMission(from: MissionState, to: MissionState): boolean { return TRANSITIONS[from]?.includes(to) ?? false }
export function assertMissionTransition(from: MissionState, to: MissionState): void { if (!canTransitionMission(from, to)) throw new Error(`Mission state violation: illegal transition ${from} → ${to}.`) }
export function getMissionTransitions(state: MissionState): readonly MissionState[] { return TRANSITIONS[state] ?? [] }

export type BusinessOutcomeType = 'TRANSACTION' | 'CUSTOMER_ACQUIRED' | 'REVENUE_RECOGNIZED' | 'REFUND' | 'COST_RECORDED' | 'KPI_SNAPSHOT'
export interface BusinessOutcomeRecord { outcomeId: string; ventureId: string; missionId: string | null; type: BusinessOutcomeType; transactionId: string | null; customerId: string | null; amount: number | null; currency: string | null; source: string; occurredAt: string; metadata: Record<string, unknown> }
const outcomeKey = (id: string) => `architecture:outcome:${id}`
export function buildOutcomeId(input: Pick<BusinessOutcomeRecord, 'ventureId' | 'missionId' | 'type' | 'transactionId' | 'customerId' | 'amount' | 'occurredAt'>): string {
  const businessKey = input.type === 'KPI_SNAPSHOT' ? input.occurredAt : input.transactionId ?? input.customerId ?? `${input.missionId ?? ''}:${input.amount ?? ''}:${input.occurredAt}`
  return stableId('outcome', input.ventureId, input.type, businessKey)
}
export function validateBusinessOutcome(input: Omit<BusinessOutcomeRecord, 'outcomeId'>): string[] {
  const errors: string[] = []
  if (!input.ventureId.trim()) errors.push('ventureId is required.')
  if (!input.source.trim()) errors.push('source is required.')
  const occurred = Date.parse(input.occurredAt)
  if (!Number.isFinite(occurred)) errors.push('occurredAt must be a valid timestamp.')
  const monetary = new Set<BusinessOutcomeType>(['TRANSACTION', 'REVENUE_RECOGNIZED', 'REFUND', 'COST_RECORDED'])
  if (monetary.has(input.type)) {
    if (input.amount == null || !Number.isFinite(input.amount) || input.amount <= 0) errors.push(`${input.type} requires a positive amount.`)
    if (!input.currency?.trim() || !/^[A-Z]{3}$/i.test(input.currency.trim())) errors.push(`${input.type} requires a three-letter currency code.`)
  }
  if ((input.type === 'TRANSACTION' || input.type === 'REVENUE_RECOGNIZED' || input.type === 'REFUND') && !input.transactionId?.trim()) errors.push(`${input.type} requires transactionId evidence.`)
  if (input.type === 'CUSTOMER_ACQUIRED' && !input.customerId?.trim()) errors.push('CUSTOMER_ACQUIRED requires customerId evidence.')
  if (input.type === 'KPI_SNAPSHOT' && (input.transactionId || input.customerId || input.amount != null || input.currency)) errors.push('KPI_SNAPSHOT cannot masquerade as a transaction/customer/monetary outcome.')
  return errors
}
function assertOutcomeIdentityCompatible(existing: BusinessOutcomeRecord, requested: BusinessOutcomeRecord): void {
  const fields: Array<keyof BusinessOutcomeRecord> = ['ventureId', 'missionId', 'type', 'transactionId', 'customerId', 'amount', 'currency', 'source', 'occurredAt']
  for (const field of fields) {
    if (JSON.stringify(existing[field]) !== JSON.stringify(requested[field])) throw new Error(`Business outcome identity collision for ${existing.outcomeId}: immutable field ${String(field)} differs.`)
  }
}
export async function recordBusinessOutcome(input: Omit<BusinessOutcomeRecord, 'outcomeId'> & Partial<Pick<BusinessOutcomeRecord, 'outcomeId'>>): Promise<BusinessOutcomeRecord> {
  if (!input.ventureId?.trim() || !input.source?.trim() || !input.occurredAt) throw new Error('ventureId, source, and occurredAt are required.')
  if (!Number.isFinite(Date.parse(input.occurredAt))) throw new Error('occurredAt must be a valid timestamp.')
  const normalized: Omit<BusinessOutcomeRecord, 'outcomeId'> = { ...input, ventureId: input.ventureId.trim(), source: input.source.trim(), occurredAt: new Date(input.occurredAt).toISOString(), missionId: input.missionId ?? null, transactionId: input.transactionId ?? null, customerId: input.customerId ?? null, amount: input.amount ?? null, currency: input.currency?.trim().toUpperCase() ?? null, metadata: input.metadata ?? {} }
  const errors = validateBusinessOutcome(normalized)
  if (errors.length) throw new Error(`Business outcome validation failed: ${errors.join(' | ')}`)
  const outcomeId = input.outcomeId ?? buildOutcomeId(normalized)
  const key = outcomeKey(outcomeId)
  const candidate: BusinessOutcomeRecord = { ...normalized, outcomeId }
  const existing = await db.memory.findUnique({ where: { key } })
  if (existing) {
    const record = JSON.parse(existing.value) as BusinessOutcomeRecord
    assertOutcomeIdentityCompatible(record, candidate)
    return record
  }
  try {
    await db.memory.create({ data: { key, value: JSON.stringify(candidate), category: 'architecture_business_outcome' } })
  } catch {
    const raced = await db.memory.findUnique({ where: { key } })
    if (!raced) throw new Error(`Business outcome ${outcomeId} could not be persisted.`)
    const record = JSON.parse(raced.value) as BusinessOutcomeRecord
    assertOutcomeIdentityCompatible(record, candidate)
    return record
  }
  return candidate
}
export async function getBusinessOutcome(outcomeId: string): Promise<BusinessOutcomeRecord | null> { const row = await db.memory.findUnique({ where: { key: outcomeKey(outcomeId) } }); return row ? JSON.parse(row.value) as BusinessOutcomeRecord : null }
export async function listBusinessOutcomes(input?: { ventureId?: string; type?: BusinessOutcomeType; limit?: number }): Promise<BusinessOutcomeRecord[]> { const rows = await db.memory.findMany({ where: { category: 'architecture_business_outcome' }, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(input?.limit ?? 100, 1), 5000) }); return rows.map((row) => { try { return JSON.parse(row.value) as BusinessOutcomeRecord } catch { return null } }).filter((item): item is BusinessOutcomeRecord => Boolean(item)).filter((item) => !input?.ventureId || item.ventureId === input.ventureId).filter((item) => !input?.type || item.type === input.type) }

export interface VentureControlContract { ventureId: string; version: number; status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'RETIRED'; allowedActions: string[]; forbiddenActions: string[]; approvalRequiredAbove: Record<string, number>; requiredEvidence: string[]; ownerApprovalRequiredFor: string[]; createdAt: string; updatedAt: string }
const contractKey = (ventureId: string) => `architecture:venture-contract:${ventureId}`
export const VENTURE_001_CONTRACT: Omit<VentureControlContract, 'createdAt' | 'updatedAt'> = { ventureId: 'venture_001', version: 1, status: 'ACTIVE', allowedActions: ['research', 'draft_product', 'create_artifact', 'verify_artifact', 'prepare_listing', 'prepare_marketing', 'analyze_kpi', 'record_customer', 'record_transaction', 'record_outcome'], forbiddenActions: ['transfer_funds', 'sign_legal_contract', 'change_business_entity', 'delete_canonical_record'], approvalRequiredAbove: { spend: 100, discount_percent: 20 }, requiredEvidence: ['market_demand', 'competition', 'automation_potential', 'time_to_revenue', 'scalability', 'recurring_revenue', 'ai_advantage'], ownerApprovalRequiredFor: ['public_launch', 'production_deploy', 'fund_transfer', 'legal_commitment', 'retire_venture'] }
const GENERIC_VENTURE_CONTRACT: Omit<VentureControlContract, 'ventureId' | 'createdAt' | 'updatedAt'> = { version: 1, status: 'DRAFT', allowedActions: ['research', 'draft_product', 'create_artifact', 'verify_artifact', 'analyze_kpi'], forbiddenActions: ['transfer_funds', 'sign_legal_contract', 'change_business_entity', 'delete_canonical_record'], approvalRequiredAbove: { spend: 0 }, requiredEvidence: [], ownerApprovalRequiredFor: ['public_launch', 'production_deploy', 'fund_transfer', 'legal_commitment', 'retire_venture'] }
function validateContract(contract: VentureControlContract): void {
  const forbidden = new Set(contract.forbiddenActions.map(normalizeId))
  const overlap = contract.allowedActions.map(normalizeId).filter((action) => forbidden.has(action))
  if (overlap.length) throw new Error(`Venture contract has overlapping allowed/forbidden actions: ${[...new Set(overlap)].join(', ')}`)
  if (!contract.ventureId.trim()) throw new Error('ventureId is required.')
  if (!Number.isInteger(contract.version) || contract.version < 1) throw new Error('Venture contract version must be a positive integer.')
  if (contract.status === 'ACTIVE' && contract.ventureId !== 'venture_001') {
    if (contract.requiredEvidence.length !== VENTURE_001_CONTRACT.requiredEvidence.length) throw new Error(`Active future venture ${contract.ventureId} must define all canonical evidence dimensions.`)
    if (new Set(contract.requiredEvidence).size !== contract.requiredEvidence.length) throw new Error(`Active future venture ${contract.ventureId} contains duplicate evidence dimensions.`)
    if (contract.requiredEvidence.some((evidence) => !VENTURE_001_CONTRACT.requiredEvidence.includes(evidence)) || VENTURE_001_CONTRACT.requiredEvidence.some((evidence) => !contract.requiredEvidence.includes(evidence))) throw new Error(`Active future venture ${contract.ventureId} evidence contract is not canonical.`)
  }
}

export async function ensureVentureControlContract(ventureId: string): Promise<VentureControlContract> {
  const normalized = normalizeId(ventureId)
  if (!normalized) throw new Error('ventureId is required.')
  const key = contractKey(normalized)
  const existing = await db.memory.findUnique({ where: { key } })
  if (existing) {
    const contract = JSON.parse(existing.value) as VentureControlContract
    validateContract(contract)
    return contract
  }
  if (normalized !== VENTURE_001_CONTRACT.ventureId) throw new Error(`No canonical Venture Control Contract exists for ${normalized}. Create one before execution.`)
  const now = new Date().toISOString()
  const contract: VentureControlContract = { ...VENTURE_001_CONTRACT, createdAt: now, updatedAt: now }
  validateContract(contract)
  try { await db.memory.create({ data: { key, value: JSON.stringify(contract), category: 'venture_control_contract' } }) }
  catch {
    const raced = await db.memory.findUnique({ where: { key } })
    if (!raced) throw new Error(`Venture control contract ${normalized} could not be persisted.`)
    const record = JSON.parse(raced.value) as VentureControlContract
    validateContract(record)
    return record
  }
  return contract
}
export interface VentureControlContractTemplateInput { allowedActions?: string[]; forbiddenActions?: string[]; approvalRequiredAbove?: Record<string, number>; requiredEvidence?: string[]; ownerApprovalRequiredFor?: string[]; status?: VentureControlContract['status'] }
export async function createVentureControlContract(ventureId: string, input?: VentureControlContractTemplateInput): Promise<VentureControlContract> {
  const normalized = normalizeId(ventureId)
  if (!normalized || normalized.length > 100) throw new Error('ventureId must be a non-empty identifier up to 100 characters.')
  const key = contractKey(normalized)
  const existing = await db.memory.findUnique({ where: { key } })
  if (existing) { const contract = JSON.parse(existing.value) as VentureControlContract; validateContract(contract); return contract }
  const base = normalized === VENTURE_001_CONTRACT.ventureId && !input ? VENTURE_001_CONTRACT : { ventureId: normalized, ...GENERIC_VENTURE_CONTRACT, ...input }
  const now = new Date().toISOString()
  const contract: VentureControlContract = { ventureId: normalized, version: 1, status: input?.status ?? base.status, allowedActions: [...(base.allowedActions ?? [])], forbiddenActions: [...(base.forbiddenActions ?? [])], approvalRequiredAbove: { ...(base.approvalRequiredAbove ?? {}) }, requiredEvidence: [...(base.requiredEvidence ?? [])], ownerApprovalRequiredFor: [...(base.ownerApprovalRequiredFor ?? [])], createdAt: now, updatedAt: now }
  validateContract(contract)
  try { await db.memory.create({ data: { key, value: JSON.stringify(contract), category: 'venture_control_contract' } }) }
  catch {
    const raced = await db.memory.findUnique({ where: { key } })
    if (!raced) throw new Error(`Venture control contract ${normalized} could not be persisted.`)
    const record = JSON.parse(raced.value) as VentureControlContract
    validateContract(record)
    return record
  }
  return contract
}
export async function assertVentureActionAllowed(ventureId: string, action: string, amount?: number): Promise<VentureControlContract> {
  const contract = await ensureVentureControlContract(ventureId)
  const normalized = normalizeId(action)
  if (!normalized) throw new Error('Venture action is required.')
  if (contract.status !== 'ACTIVE') throw new Error(`Venture ${ventureId} is ${contract.status}; action ${action} is blocked.`)
  if (contract.forbiddenActions.map(normalizeId).includes(normalized)) throw new Error(`Venture Control Contract forbids action: ${action}.`)
  if (!contract.allowedActions.map(normalizeId).includes(normalized)) throw new Error(`Venture Control Contract does not authorize action: ${action}.`)
  if (amount != null && (!Number.isFinite(amount) || amount < 0)) throw new Error('Action amount must be a finite non-negative number.')
  if (amount != null && contract.approvalRequiredAbove.spend != null && amount > contract.approvalRequiredAbove.spend) throw new Error(`Venture Control Contract requires owner approval for spend above ${contract.approvalRequiredAbove.spend}.`)
  return contract
}
export function runArchitectureControlPlaneSelfCheck(): { ok: boolean; findings: string[] } {
  const findings: string[] = []
  try { assertDelegationAllowed({ actorId: 'ceo', actorLevel: 'CEO', targetId: 'vid', targetLevel: 'VID' }) } catch (error) { findings.push(String(error)) }
  try { assertDelegationAllowed({ actorId: 'ceo', actorLevel: 'SPECIALIST', targetId: 'vid', targetLevel: 'VID' }); findings.push('Forged actor level was accepted.') } catch { /* expected */ }
  try { assertDelegationAllowed({ actorId: 'ceo', actorLevel: 'CEO', targetId: 'aurora', targetLevel: 'LEADER' }); findings.push('CEO bypassed VID.') } catch { /* expected */ }
  try { assertDelegationAllowed({ actorId: 'unknown_actor', actorLevel: 'SPECIALIST', targetId: 'quill', targetLevel: 'SPECIALIST' }); findings.push('Unknown actor identity was accepted.') } catch { /* expected */ }
  try { assertDelegationAllowed({ actorId: 'aurora', actorLevel: 'LEADER', targetId: 'unknown_tool', targetLevel: 'TOOL' }); findings.push('Unknown tool identity was accepted.') } catch { /* expected */ }
  if (canTransitionMission('COMPLETED', 'IN_PROGRESS')) findings.push('COMPLETED must be terminal.')
  if (!canTransitionMission('VERIFIED', 'OWNER_APPROVAL')) findings.push('VERIFIED must transition to OWNER_APPROVAL.')
  if (VENTURE_001_CONTRACT.ventureId !== 'venture_001') findings.push('Venture 001 contract identity drifted.')
  const outcomeErrors = validateBusinessOutcome({ ventureId: 'venture_001', missionId: null, type: 'REVENUE_RECOGNIZED', transactionId: null, customerId: null, amount: 10, currency: 'USD', source: 'self-check', occurredAt: new Date().toISOString(), metadata: {} })
  if (outcomeErrors.length === 0) findings.push('Revenue outcomes must require transaction evidence.')
  return { ok: findings.length === 0, findings }
}
