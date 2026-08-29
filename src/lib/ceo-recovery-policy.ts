import type { CeoExecutionContract } from './ceo-cognitive-contract'
import type { CeoFailureReason } from './ceo-failure-reason'

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
  failureReason: CeoFailureReason
}

export class RecoveryBudgetExceededError extends Error {
  readonly code = 'CEO_RECOVERY_BUDGET_EXCEEDED'
  readonly failureReason: CeoFailureReason = 'recovery_budget_exhausted'
  readonly count: number
  readonly maxRecoveries: number

  constructor(count: number, maxRecoveries: number, reason: string) {
    super(reason)
    this.name = 'RecoveryBudgetExceededError'
    this.count = count
    this.maxRecoveries = maxRecoveries
  }
}

/** Request-scoped recovery guard with canonical failure reasons. */
export class RecoveryBudget {
  private count = 0

  constructor(private readonly contract: CeoExecutionContract) {}

  get used(): number { return this.count }
  get remaining(): number { return Math.max(0, this.contract.maxRecoveries - this.count) }

  consume(event: RecoveryEvent): RecoveryDecision {
    const failureReason: CeoFailureReason = event === 'provider_failure'
      ? 'provider_error'
      : event === 'tool_failure'
        ? 'tool_error'
        : event === 'quality_failure'
          ? 'quality_failure'
          : event === 'timeout_risk'
            ? 'provider_timeout'
            : 'unknown'

    if (event === 'auto_recovery' && !this.contract.toolRequired && !this.contract.subagentsRequired) {
      return {
        allowed: false,
        count: this.count,
        maxRecoveries: this.contract.maxRecoveries,
        reason: `Recovery denied: ${this.contract.intent} is non-operational and does not permit execution recovery.`,
        failureReason,
      }
    }

    if (this.count >= this.contract.maxRecoveries) {
      return {
        allowed: false,
        count: this.count,
        maxRecoveries: this.contract.maxRecoveries,
        reason: `Recovery budget exhausted (${this.contract.maxRecoveries}) for ${this.contract.intent}.`,
        failureReason: 'recovery_budget_exhausted',
      }
    }

    this.count += 1
    return {
      allowed: true,
      count: this.count,
      maxRecoveries: this.contract.maxRecoveries,
      reason: `${event} recovery ${this.count}/${this.contract.maxRecoveries} permitted.`,
      failureReason,
    }
  }
}

export function recoveryEventFromMessage(message: unknown): RecoveryEvent | null {
  const text = String(message ?? '').trim()
  if (!text.startsWith('[AUTO-RECOVERY]')) return null
  return 'auto_recovery'
}
