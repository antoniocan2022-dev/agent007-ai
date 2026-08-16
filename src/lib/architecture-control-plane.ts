/**
 * Agent007 Architecture Control Plane — Changes 5–9
 *
 * Single canonical module for the five architectural invariants:
 * 5. Universal hierarchy enforcement
 * 6. Canonical Artifact Ledger
 * 7. Formal Mission State Machine
 * 8. Business Outcome Ledger
 * 9. Venture Control Contract
 *
 * Design goals:
 * - one source of truth per concern
 * - deterministic/idempotent identifiers
 * - append-only audit events for ledger concerns
 * - explicit state-transition and authority rules
 * - persistence through the existing DB Memory substrate so no parallel
 *   registry/database is introduced
 * - pure/in-memory adapters are available for CI tests
 */

import { createHash } from 'node:crypto'
import { db } from './db'

// ---------------------------------------------------------------------------
// 5. UNIVERSAL HIERARCHY ENFORCEMENT
// ---------------------------------------------------------------------------

export type AuthorityLevel = 'CEO' | 'VID' | 'LEADER' | 'SPECIALIST' | 'TOOL'

export interface DelegationRequest {
  actorId: string
  actorLevel: AuthorityLevel
  targetId: string
  targetLevel: AuthorityLevel
  delegatedBy?: string
}

const LEADERS = new Set([
  'scout', 'aurora', 'vertex', 'quantum', 'echo', 'forge', 'pulse', 'quill',
  'prism', 'legal', 'banker', 'hunt', 'developer', 'cybersecurity_a',
  'cybersecurity_r', 'trader', 'revenue', 'external_uptime_monitor', 'qa_monitor',
])

const CEO_IDS = new Set(['ceo', 'agent007', 'super-agent', 'super_agent', 'owner'])
const VID_IDS = new Set(['vid', 'vid_director'])

function normalizeId(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '_')
}

export function authorityLevelFor(id: string): AuthorityLevel {
  const normalized = normalizeId(id)
  if (CEO_IDS.has(normalized)) return 'CEO'
  if (VID_IDS.has(normalized)) return 'VID'
  if (LEADERS.has(normalized)) return 'LEADER'
  return 'SPECIALIST'
}

/**
 * Enforce the enterprise chain of command.
 * CEO may only delegate to VID; VID may delegate to leaders; leaders may
 * delegate to specialists/tools.
 */
export function assertDelegationAllowed(request: DelegationRequest): void {
  const actor = normalizeId(request.actorId)
  const target = normalizeId(request.targetId)
  const actorLevel = request.actorLevel
  const targetLevel = request.targetLevel

  if (!actor || !target) throw new Error('Hierarchy violation: actorId and targetId are required.')

  if (actorLevel === 'CEO') {
    if (targetLevel !== 'VID' || !VID_IDS.has(target)) {
      throw new Error(`Hierarchy violation: CEO may delegate only to VID; attempted target=${target}.`)
    }
    return
  }

  if (actorLevel === 'VID') {
    if (targetLevel !== 'LEADER' || !LEADERS.has(target)) {
      throw new Error(`Hierarchy violation: VID may delegate only to registered leaders; attempted target=${target}.`)
    }
    return
  }

  if (actorLevel === 'LEADER') {
    if (targetLevel !== 'SPECIALIST' && targetLevel !== 'TOOL') {
      throw new Error(`Hierarchy violation: leader ${actor} may delegate only to specialists/tools; attempted target=${target}.`)
    }
    return
  }

  throw new Error(`Hierarchy violation: ${actorLevel} is not authorized to delegate to ${target}.`)
}

/** Route a CEO/VID request to the required immediate authority layer. */
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

// ---------------------------------------------------------------------------
// 6. CANONICAL ARTIFACT LEDGER
// ---------------------------------------------------------------------------

export type ArtifactStatus = 'PRODUCED' | 'VERIFIED' | 'REJECTED' | 'SUPERSEDED'
export type ArtifactKind = 'url' | 'transaction_id' | 'message_id' | 'file_path' | 'data' | 'none'

export interface ArtifactRecord {
  artifactId: string
  ventureId: string | null
  missionId: string | null
  stage: string
  producer: string
  consumers: string[]
  artifactType: ArtifactKind
  value: string
  version: number
  status: ArtifactStatus
  verifiedAt: string | null
  verificationSource: string | null
  createdAt: string
  supersedes: string | null
}

interface ArtifactLedgerEvent {
  eventId: string
  artifactId: string
  type: 'PRODUCED' | 'VERIFIED' | 'REJECTED' | 'SUPERSEDED'
  actor: string
  timestamp: string
  metadata?: Record<string, unknown>
}

function stableId(prefix: string, ...parts: string[]): string {
  const input = parts.map((part) => part.trim()).join('|')
  return `${prefix}_${createHash('sha256').update(input).digest('hex').slice(0, 24)}`
}

function artifactKey(id: string): string { return `architecture:artifact:${id}` }
function artifactEventKey(id: string): string { return `architecture:artifact:event:${id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}` }

export function buildArtifactId(input: Pick<ArtifactRecord, 'ventureId' | 'missionId' | 'stage' | 'artifactType' | 'value'>): string {
  return stableId('artifact', input.ventureId ?? '', input.missionId ?? '', input.stage, input.artifactType, input.value)
}

export async function registerArtifact(input: Omit<ArtifactRecord, 'artifactId' | 'createdAt' | 'status' | 'verifiedAt' | 'verificationSource'> & Partial<Pick<ArtifactRecord, 'artifactId' | 'createdAt'>>): Promise<ArtifactRecord> {
  const artifactId = input.artifactId ?? buildArtifactId(input)
  const key = artifactKey(artifactId)
  const existing = await db.memory.findUnique({ where: { key } })
  if (existing) return JSON.parse(existing.value) as ArtifactRecord

  const record: ArtifactRecord = {
    artifactId,
    ventureId: input.ventureId ?? null,
    missionId: input.missionId ?? null,
    stage: input.stage,
    producer: input.producer,
    consumers: [...new Set(input.consumers ?? [])],
    artifactType: input.artifactType,
    value: input.value,
    version: input.version ?? 1,
    status: 'PRODUCED',
    verifiedAt: null,
    verificationSource: null,
    createdAt: input.createdAt ?? new Date().toISOString(),
    supersedes: input.supersedes ?? null,
  }
  await db.memory.create({ data: { key, value: JSON.stringify(record), category: 'architecture_artifact' } })
  const event: ArtifactLedgerEvent = {
    eventId: artifactEventKey(artifactId),
    artifactId,
    type: 'PRODUCED',
    actor: input.producer,
    timestamp: record.createdAt,
  }
  await db.memory.create({ data: { key: event.eventId, value: JSON.stringify(event), category: 'architecture_artifact_event' } })
  return record
}

export async function verifyArtifact(artifactId: string, actor: string, source: string): Promise<ArtifactRecord> {
  const row = await db.memory.findUnique({ where: { key: artifactKey(artifactId) } })
  if (!row) throw new Error(`Artifact not found: ${artifactId}`)
  const record = JSON.parse(row.value) as ArtifactRecord
  if (record.status === 'VERIFIED') return record
  record.status = 'VERIFIED'
  record.verifiedAt = new Date().toISOString()
  record.verificationSource = source
  await db.memory.update({ where: { key: artifactKey(artifactId) }, data: { value: JSON.stringify(record) } })
  const event: ArtifactLedgerEvent = {
    eventId: artifactEventKey(artifactId),
    artifactId,
    type: 'VERIFIED',
    actor,
    timestamp: record.verifiedAt,
    metadata: { source },
  }
  await db.memory.create({ data: { key: event.eventId, value: JSON.stringify(event), category: 'architecture_artifact_event' } })
  return record
}

export async function getArtifact(artifactId: string): Promise<ArtifactRecord | null> {
  const row = await db.memory.findUnique({ where: { key: artifactKey(artifactId) } })
  return row ? JSON.parse(row.value) as ArtifactRecord : null
}

// ---------------------------------------------------------------------------
// 7. FORMAL MISSION STATE MACHINE
// ---------------------------------------------------------------------------

export type MissionState = 'PLANNED' | 'IN_PROGRESS' | 'REVIEW' | 'DELIVERED' | 'VERIFIED' | 'OWNER_APPROVAL' | 'COMPLETED' | 'BLOCKED' | 'FAILED'

const TRANSITIONS: Record<MissionState, readonly MissionState[]> = {
  PLANNED: ['IN_PROGRESS', 'FAILED'],
  IN_PROGRESS: ['REVIEW', 'FAILED', 'BLOCKED'],
  REVIEW: ['DELIVERED', 'IN_PROGRESS', 'FAILED', 'BLOCKED'],
  DELIVERED: ['VERIFIED', 'REVIEW', 'FAILED', 'BLOCKED'],
  VERIFIED: ['OWNER_APPROVAL', 'FAILED', 'BLOCKED'],
  OWNER_APPROVAL: ['COMPLETED', 'VERIFIED', 'FAILED'],
  COMPLETED: [],
  BLOCKED: ['IN_PROGRESS', 'REVIEW', 'FAILED'],
  FAILED: [],
}

export function canTransitionMission(from: MissionState, to: MissionState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}

export function assertMissionTransition(from: MissionState, to: MissionState): void {
  if (!canTransitionMission(from, to)) {
    throw new Error(`Mission state violation: illegal transition ${from} → ${to}.`)
  }
}

export function getMissionTransitions(state: MissionState): readonly MissionState[] {
  return TRANSITIONS[state] ?? []
}

// ---------------------------------------------------------------------------
// 8. BUSINESS OUTCOME LEDGER
// ---------------------------------------------------------------------------

export type BusinessOutcomeType = 'TRANSACTION' | 'CUSTOMER_ACQUIRED' | 'REVENUE_RECOGNIZED' | 'REFUND' | 'COST_RECORDED' | 'KPI_SNAPSHOT'

export interface BusinessOutcomeRecord {
  outcomeId: string
  ventureId: string
  missionId: string | null
  type: BusinessOutcomeType
  transactionId: string | null
  customerId: string | null
  amount: number | null
  currency: string | null
  source: string
  occurredAt: string
  metadata: Record<string, unknown>
}

function outcomeKey(id: string): string { return `architecture:outcome:${id}` }

export function buildOutcomeId(input: Pick<BusinessOutcomeRecord, 'ventureId' | 'missionId' | 'type' | 'transactionId' | 'customerId' | 'amount' | 'occurredAt'>): string {
  return stableId('outcome', input.ventureId, input.missionId ?? '', input.type, input.transactionId ?? '', input.customerId ?? '', String(input.amount ?? ''), input.occurredAt)
}

export async function recordBusinessOutcome(input: Omit<BusinessOutcomeRecord, 'outcomeId'> & Partial<Pick<BusinessOutcomeRecord, 'outcomeId'>>): Promise<BusinessOutcomeRecord> {
  const outcomeId = input.outcomeId ?? buildOutcomeId(input)
  const key = outcomeKey(outcomeId)
  const existing = await db.memory.findUnique({ where: { key } })
  if (existing) return JSON.parse(existing.value) as BusinessOutcomeRecord
  const record: BusinessOutcomeRecord = {
    ...input,
    outcomeId,
    missionId: input.missionId ?? null,
    transactionId: input.transactionId ?? null,
    customerId: input.customerId ?? null,
    amount: input.amount ?? null,
    currency: input.currency ?? null,
    metadata: input.metadata ?? {},
  }
  await db.memory.create({ data: { key, value: JSON.stringify(record), category: 'architecture_business_outcome' } })
  return record
}

export async function getBusinessOutcome(outcomeId: string): Promise<BusinessOutcomeRecord | null> {
  const row = await db.memory.findUnique({ where: { key: outcomeKey(outcomeId) } })
  return row ? JSON.parse(row.value) as BusinessOutcomeRecord : null
}

// ---------------------------------------------------------------------------
// 9. VENTURE CONTROL CONTRACT
// ---------------------------------------------------------------------------

export interface VentureControlContract {
  ventureId: string
  version: number
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'RETIRED'
  allowedActions: string[]
  forbiddenActions: string[]
  approvalRequiredAbove: Record<string, number>
  requiredEvidence: string[]
  ownerApprovalRequiredFor: string[]
  createdAt: string
  updatedAt: string
}

function contractKey(ventureId: string): string { return `architecture:venture-contract:${ventureId}` }

export const VENTURE_001_CONTRACT: Omit<VentureControlContract, 'createdAt' | 'updatedAt'> = {
  ventureId: 'venture_001',
  version: 1,
  status: 'ACTIVE',
  allowedActions: [
    'research', 'draft_product', 'create_artifact', 'verify_artifact', 'prepare_listing',
    'prepare_marketing', 'analyze_kpi', 'record_customer', 'record_transaction', 'record_outcome',
  ],
  forbiddenActions: ['transfer_funds', 'sign_legal_contract', 'change_business_entity', 'delete_canonical_record'],
  approvalRequiredAbove: { spend: 100, discount_percent: 20 },
  requiredEvidence: ['market_demand', 'competition', 'automation_potential', 'time_to_revenue', 'scalability', 'recurring_revenue', 'ai_advantage'],
  ownerApprovalRequiredFor: ['public_launch', 'production_deploy', 'fund_transfer', 'legal_commitment', 'retire_venture'],
}

export async function ensureVentureControlContract(ventureId: string): Promise<VentureControlContract> {
  const key = contractKey(ventureId)
  const existing = await db.memory.findUnique({ where: { key } })
  if (existing) return JSON.parse(existing.value) as VentureControlContract
  if (ventureId !== 'venture_001') throw new Error(`No canonical Venture Control Contract exists for ${ventureId}. Create one before execution.`)
  const now = new Date().toISOString()
  const contract: VentureControlContract = { ...VENTURE_001_CONTRACT, createdAt: now, updatedAt: now }
  await db.memory.create({ data: { key, value: JSON.stringify(contract), category: 'venture_control_contract' } })
  return contract
}

export async function assertVentureActionAllowed(ventureId: string, action: string, amount?: number): Promise<VentureControlContract> {
  const contract = await ensureVentureControlContract(ventureId)
  const normalized = normalizeId(action)
  if (contract.status !== 'ACTIVE') throw new Error(`Venture ${ventureId} is ${contract.status}; action ${action} is blocked.`)
  if (contract.forbiddenActions.map(normalizeId).includes(normalized)) throw new Error(`Venture Control Contract forbids action: ${action}.`)
  if (!contract.allowedActions.map(normalizeId).includes(normalized)) throw new Error(`Venture Control Contract does not authorize action: ${action}.`)
  if (amount != null && contract.approvalRequiredAbove.spend != null && amount > contract.approvalRequiredAbove.spend) {
    throw new Error(`Venture Control Contract requires owner approval for spend above ${contract.approvalRequiredAbove.spend}.`)
  }
  return contract
}

// ---------------------------------------------------------------------------
// Cross-cutting integrity check used by CI and health endpoints.
// ---------------------------------------------------------------------------

export function runArchitectureControlPlaneSelfCheck(): { ok: boolean; findings: string[] } {
  const findings: string[] = []
  try { assertDelegationAllowed({ actorId: 'ceo', actorLevel: 'CEO', targetId: 'vid', targetLevel: 'VID' }) } catch (e) { findings.push(String(e)) }
  if (canTransitionMission('COMPLETED', 'IN_PROGRESS')) findings.push('COMPLETED must be terminal.')
  if (!canTransitionMission('VERIFIED', 'OWNER_APPROVAL')) findings.push('VERIFIED must transition to OWNER_APPROVAL.')
  if (VENTURE_001_CONTRACT.ventureId !== 'venture_001') findings.push('Venture 001 contract identity drifted.')
  if (VENTURE_001_CONTRACT.forbiddenActions.some((a) => VENTURE_001_CONTRACT.allowedActions.includes(a))) findings.push('Venture contract contains an action in both allowed and forbidden sets.')
  return { ok: findings.length === 0, findings }
}
