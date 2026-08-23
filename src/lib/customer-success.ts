import { db } from './db'
import { getVenture } from './venture-commercial-foundation'

export type CustomerSuccessLifecycle =
  | 'ONBOARDING'
  | 'ACTIVATING'
  | 'VALUE_REALIZED'
  | 'AT_RISK'
  | 'RENEWAL_PENDING'
  | 'RETAINED'
  | 'CHURNED'
  | 'PAUSED'

export type ActivationStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'ACTIVE' | 'BLOCKED'
export type CustomerRisk = 'UNKNOWN' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface CustomerSuccessState {
  id: string
  ventureId: string
  customerId: string
  lifecycle: CustomerSuccessLifecycle
  activationStatus: ActivationStatus
  riskLevel: CustomerRisk
  healthScore: number | null
  satisfactionScore: number | null
  lastValueAt: string | null
  renewalAt: string | null
  nextBestAction: string | null
  ownerUserId: string | null
  createdAt: string
  updatedAt: string
}

const LIFECYCLE_TRANSITIONS: Record<CustomerSuccessLifecycle, readonly CustomerSuccessLifecycle[]> = {
  ONBOARDING: ['ACTIVATING', 'PAUSED', 'CHURNED'],
  ACTIVATING: ['VALUE_REALIZED', 'AT_RISK', 'PAUSED', 'CHURNED'],
  VALUE_REALIZED: ['AT_RISK', 'RENEWAL_PENDING', 'RETAINED', 'PAUSED', 'CHURNED'],
  AT_RISK: ['ACTIVATING', 'VALUE_REALIZED', 'RENEWAL_PENDING', 'RETAINED', 'PAUSED', 'CHURNED'],
  RENEWAL_PENDING: ['RETAINED', 'AT_RISK', 'CHURNED', 'PAUSED'],
  RETAINED: ['VALUE_REALIZED', 'RENEWAL_PENDING', 'AT_RISK', 'PAUSED', 'CHURNED'],
  CHURNED: ['ONBOARDING'],
  PAUSED: ['ONBOARDING', 'ACTIVATING', 'VALUE_REALIZED', 'AT_RISK', 'RENEWAL_PENDING', 'RETAINED', 'CHURNED'],
}

const score = (value: number | null | undefined, field: string): number | null => {
  if (value == null) return null
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error(`${field} must be between 0 and 100.`)
  return Number(value)
}

function clean(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function stateId(ventureId: string, customerId: string): string {
  return `cs:${ventureId}:${customerId}`
}

async function assertCustomerScope(customerId: string, ventureId: string): Promise<void> {
  if (!await getVenture(ventureId)) throw new Error(`Venture not found: ${ventureId}.`)
  const rows = await db.$queryRaw<Array<{ id: string; ventureId: string | null }>>`
    SELECT "id","ventureId" FROM "Customer" WHERE "id"=${customerId} LIMIT 1
  `
  if (!rows[0]) throw new Error(`Customer not found: ${customerId}.`)
  if (rows[0].ventureId !== ventureId) throw new Error(`Customer ${customerId} does not belong to venture ${ventureId}.`)
}

export function canTransitionCustomerSuccess(from: CustomerSuccessLifecycle, to: CustomerSuccessLifecycle): boolean {
  return LIFECYCLE_TRANSITIONS[from]?.includes(to) ?? false
}

export async function getCustomerSuccessState(ventureId: string, customerId: string): Promise<CustomerSuccessState | null> {
  await assertCustomerScope(customerId, ventureId)
  const rows = await db.$queryRaw<CustomerSuccessState[]>`
    SELECT "id","ventureId","customerId","lifecycle","activationStatus","riskLevel","healthScore","satisfactionScore","lastValueAt","renewalAt","nextBestAction","ownerUserId","createdAt","updatedAt"
    FROM "CustomerSuccessState" WHERE "ventureId"=${ventureId} AND "customerId"=${customerId} LIMIT 1
  `
  return rows[0] ?? null
}

export async function ensureCustomerSuccessState(ventureId: string, customerId: string, ownerUserId: string | null = null): Promise<CustomerSuccessState> {
  await assertCustomerScope(customerId, ventureId)
  const existing = await getCustomerSuccessState(ventureId, customerId)
  if (existing) return existing
  const id = stateId(ventureId, customerId)
  await db.$executeRaw`
    INSERT INTO "CustomerSuccessState" ("id","ventureId","customerId","lifecycle","activationStatus","riskLevel","healthScore","satisfactionScore","lastValueAt","renewalAt","nextBestAction","ownerUserId")
    VALUES (${id},${ventureId},${customerId},'ONBOARDING','NOT_STARTED','UNKNOWN',NULL,NULL,NULL,NULL,NULL,${ownerUserId})
    ON CONFLICT ("ventureId","customerId") DO NOTHING
  `
  const state = await getCustomerSuccessState(ventureId, customerId)
  if (!state) throw new Error(`Customer Success state could not be created for ${ventureId}/${customerId}.`)
  return state
}

export async function transitionCustomerSuccess(
  ventureId: string,
  customerId: string,
  next: CustomerSuccessLifecycle,
  patch: Partial<Pick<CustomerSuccessState, 'activationStatus' | 'riskLevel' | 'nextBestAction' | 'ownerUserId' | 'renewalAt'>> & {
    healthScore?: number | null
    satisfactionScore?: number | null
    lastValueAt?: string | null
  } = {},
): Promise<CustomerSuccessState> {
  const current = await ensureCustomerSuccessState(ventureId, customerId, patch.ownerUserId ?? null)
  if (!canTransitionCustomerSuccess(current.lifecycle, next)) {
    throw new Error(`Illegal customer-success lifecycle transition: ${current.lifecycle} → ${next}.`)
  }
  const lastValueAt = patch.lastValueAt == null ? current.lastValueAt : new Date(patch.lastValueAt).toISOString()
  const renewalAt = patch.renewalAt == null ? current.renewalAt : new Date(patch.renewalAt).toISOString()
  if (patch.lastValueAt != null && !Number.isFinite(Date.parse(patch.lastValueAt))) throw new Error('lastValueAt must be a valid timestamp.')
  if (patch.renewalAt != null && !Number.isFinite(Date.parse(patch.renewalAt))) throw new Error('renewalAt must be a valid timestamp.')

  await db.$executeRaw`
    UPDATE "CustomerSuccessState"
    SET "lifecycle"=${next},
        "activationStatus"=${patch.activationStatus ?? current.activationStatus},
        "riskLevel"=${patch.riskLevel ?? current.riskLevel},
        "healthScore"=${score(patch.healthScore, 'healthScore') ?? current.healthScore},
        "satisfactionScore"=${score(patch.satisfactionScore, 'satisfactionScore') ?? current.satisfactionScore},
        "lastValueAt"=${lastValueAt},
        "renewalAt"=${renewalAt},
        "nextBestAction"=${patch.nextBestAction == null ? current.nextBestAction : clean(patch.nextBestAction)},
        "ownerUserId"=${patch.ownerUserId == null ? current.ownerUserId : clean(patch.ownerUserId)},
        "updatedAt"=CURRENT_TIMESTAMP
    WHERE "ventureId"=${ventureId} AND "customerId"=${customerId}
  `
  const updated = await getCustomerSuccessState(ventureId, customerId)
  if (!updated) throw new Error(`Customer Success state disappeared during transition for ${ventureId}/${customerId}.`)
  return updated
}

export async function listCustomerSuccessStates(ventureId: string): Promise<CustomerSuccessState[]> {
  if (!await getVenture(ventureId)) throw new Error(`Venture not found: ${ventureId}.`)
  return db.$queryRaw<CustomerSuccessState[]>`
    SELECT "id","ventureId","customerId","lifecycle","activationStatus","riskLevel","healthScore","satisfactionScore","lastValueAt","renewalAt","nextBestAction","ownerUserId","createdAt","updatedAt"
    FROM "CustomerSuccessState" WHERE "ventureId"=${ventureId} ORDER BY "updatedAt" DESC
  `
}

export async function getCustomerSuccessSnapshot(ventureId: string) {
  const rows = await listCustomerSuccessStates(ventureId)
  const withHealth = rows.filter((row) => row.healthScore != null)
  return {
    ventureId,
    totalCustomersWithState: rows.length,
    valueRealized: rows.filter((row) => row.lifecycle === 'VALUE_REALIZED' || row.lifecycle === 'RETAINED').length,
    atRisk: rows.filter((row) => row.lifecycle === 'AT_RISK').length,
    renewalPending: rows.filter((row) => row.lifecycle === 'RENEWAL_PENDING').length,
    churned: rows.filter((row) => row.lifecycle === 'CHURNED').length,
    active: rows.filter((row) => !['CHURNED', 'PAUSED'].includes(row.lifecycle)).length,
    measuredHealthCount: withHealth.length,
    averageHealthScore: withHealth.length ? Number((withHealth.reduce((sum, row) => sum + Number(row.healthScore), 0) / withHealth.length).toFixed(2)) : null,
  }
}
