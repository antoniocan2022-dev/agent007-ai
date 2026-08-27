import type { CeoExecutionContract } from './ceo-cognitive-contract'

export type RecoveryEvent =
  | 'auto_recovery'
  | 'provider_failure'
  | 'tool_failure'
  | 'quality_failure'
  | 'timeout_risk'

export interface RecoveryDecision {
  allowed: boolean
  count: number
  maxRecoveries: number
  reason: string
}

export class RecoveryBudgetExceededError extends Error {
  readonly code = 'CEO_RECOVERY_BUDGET_EXCEEDED'
  readonly count: number
  readonly maxRecoveries: number

  constructor(count: number, maxRecoveries: number, reason: string) {
    super(reason)
    this.name = 'RecoveryBudgetExceededError'
    this.count = count
    this.maxRecoveries = maxRecoveries
  }
}

/**
 * Request-scoped recovery guard.
 *
 * The legacy orchestrator still emits generic [AUTO-RECOVERY] events while it
 * is being migrated. This guard provides a hard request-level ceiling so one
 * false-positive detector cannot consume the entire HTTP budget.
 *
 * Non-operational CEO contracts are never permitted to recover through the
 * operational orchestrator. Operational contracts may consume only the
 * recovery budget explicitly declared by their execution contract.
 */
export class RecoveryBudget {
  private count = 0

  constructor(private readonly contract: CeoExecutionContract) {}

  get used(): number {
    return this.count
  }

  get remaining(): number {
    return Math.max(0, this.contract.maxRecoveries - this.count)
  }

  consume(event: RecoveryEvent): RecoveryDecision {
    if (event === 'auto_recovery' && !this.contract.toolRequired && !this.contract.subagentsRequired) {
      return {
        allowed: false,
        count: this.count,
        maxRecoveries: this.contract.maxRecoveries,
        reason: `Recovery denied: ${this.contract.intent} is non-operational and does not permit execution recovery.`,
      }
    }

    if (this.count >= this.contract.maxRecoveries) {
      return {
        allowed: false,
        count: this.count,
        maxRecoveries: this.contract.maxRecoveries,
        reason: `Recovery budget exhausted (${this.contract.maxRecoveries}) for ${this.contract.intent}.`,
      }
    }

    this.count += 1
    return {
      allowed: true,
      count: this.count,
      maxRecoveries: this.contract.maxRecoveries,
      reason: `${event} recovery ${this.count}/${this.contract.maxRecoveries} permitted.`,
    }
  }
}

export function recoveryEventFromMessage(message: unknown): RecoveryEvent | null {
  const text = String(message ?? '').trim()
  if (!text.startsWith('[AUTO-RECOVERY]')) return null
  if (/promise|waiting|stuck|continue/i.test(text)) return 'auto_recovery'
  return 'auto_recovery'
}
