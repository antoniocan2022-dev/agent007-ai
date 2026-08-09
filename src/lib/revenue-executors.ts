import type { RevenueExecutionAction } from '@/lib/revenue-execution'

export type RevenueExecutorContext = {
  actionId: string
  action: RevenueExecutionAction
  attrs: Record<string, unknown>
}

export type RevenueExecutorResult = {
  externalSideEffect: boolean
  revenueVerified: boolean
  reference?: string
  details?: Record<string, unknown>
}

export type RevenueExecutor = {
  id: string
  action: RevenueExecutionAction
  capability: 'outreach' | 'checkout' | 'fulfillment' | 'offer'
  enabled: boolean
  execute: (context: RevenueExecutorContext) => Promise<RevenueExecutorResult>
}

const unavailable = (id: string, action: RevenueExecutionAction, capability: RevenueExecutor['capability']): RevenueExecutor => ({
  id,
  action,
  capability,
  enabled: false,
  async execute() {
    throw new Error(`No authorized ${capability} executor is configured for ${action}.`)
  },
})

/**
 * Explicit executor registry.
 *
 * This registry is intentionally closed-world: an approved action cannot create
 * a generic side effect. A capability-specific adapter must be registered and
 * enabled before execution is possible.
 */
export const REVENUE_EXECUTORS: RevenueExecutor[] = [
  unavailable('offer-preparation-v1', 'prepare_offer', 'offer'),
  unavailable('outreach-v1', 'prepare_outreach', 'outreach'),
  unavailable('checkout-v1', 'prepare_checkout', 'checkout'),
  unavailable('fulfillment-v1', 'prepare_fulfillment', 'fulfillment'),
]

export function getRevenueExecutor(action: RevenueExecutionAction) {
  return REVENUE_EXECUTORS.find((executor) => executor.action === action) ?? null
}

export function getRevenueExecutorCatalog() {
  return REVENUE_EXECUTORS.map(({ execute: _execute, ...executor }) => executor)
}
