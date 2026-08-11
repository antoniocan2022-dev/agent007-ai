export const REVENUE_ACTIONS = ['prepare_offer', 'prepare_outreach', 'prepare_checkout', 'prepare_fulfillment'] as const

export type RevenueAction = (typeof REVENUE_ACTIONS)[number]
export type RevenueStatus = 'pending' | 'approved' | 'executing' | 'done' | 'failed' | 'cancelled'

export type RevenueRequest = {
  action: RevenueAction
  idempotencyKey: string
  customerId?: string
  serviceId?: string
  opportunityId?: string
  payload?: Record<string, unknown>
}

const MAX_KEY_LENGTH = 200
const MAX_PAYLOAD_BYTES = 8192
const MAX_DEPTH = 5
const SENSITIVE = /(password|secret|token|api[-_]?key|private[-_]?key|authorization|cookie)/i

const TRANSITIONS: Record<RevenueStatus, readonly RevenueStatus[]> = {
  pending: ['approved', 'cancelled'],
  approved: ['executing', 'cancelled'],
  executing: ['done', 'failed'],
  done: [],
  failed: [],
  cancelled: [],
}

export function isAllowedRevenueAction(action: string): action is RevenueAction {
  return (REVENUE_ACTIONS as readonly string[]).includes(action)
}

export function canTransition(from: RevenueStatus, to: RevenueStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}

export function executionActionName(action: RevenueAction, idempotencyKey: string): string {
  return `revenue.${action}:${idempotencyKey.trim().replace(/\s+/g, ' ')}`
}

function validatePayload(value: unknown, depth: number): void {
  if (depth > MAX_DEPTH) throw new Error('Revenue payload is too deeply nested')
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return
  if (Array.isArray(value)) {
    for (const item of value) validatePayload(item, depth + 1)
    return
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE.test(key)) throw new Error(`Sensitive payload field is not allowed: ${key}`)
      validatePayload(child, depth + 1)
    }
    return
  }
  throw new Error('Revenue payload contains an unsupported value')
}

export function validateRevenueRequest(input: RevenueRequest): RevenueRequest {
  if (!isAllowedRevenueAction(input.action)) throw new Error('Unsupported revenue execution action')

  const idempotencyKey = input.idempotencyKey.trim().replace(/\s+/g, ' ')
  if (!idempotencyKey) throw new Error('idempotencyKey is required')
  if (idempotencyKey.length > MAX_KEY_LENGTH) throw new Error('idempotencyKey is too long')

  const payload = input.payload ?? {}
  validatePayload(payload, 0)
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_PAYLOAD_BYTES) {
    throw new Error('Revenue payload is too large')
  }

  return {
    action: input.action,
    idempotencyKey,
    customerId: input.customerId?.trim() || undefined,
    serviceId: input.serviceId?.trim() || undefined,
    opportunityId: input.opportunityId?.trim() || undefined,
    payload,
  }
}

export function assertCompletionEvidence(input: {
  externalSideEffect: boolean
  provider?: string
  providerReference?: string
  revenueVerified?: boolean
}): void {
  if (!input.externalSideEffect && input.revenueVerified) {
    throw new Error('Revenue cannot be marked verified without an external provider side effect')
  }
  if (input.externalSideEffect && (!input.provider?.trim() || !input.providerReference?.trim())) {
    throw new Error('Provider evidence is required when an external side effect occurred')
  }
}
