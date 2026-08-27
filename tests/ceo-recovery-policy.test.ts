import { describe, expect, test } from 'bun:test'
import { RecoveryBudget, recoveryEventFromMessage, type RecoveryEvent } from '@/lib/ceo-recovery-policy'

describe('CEO recovery policy', () => {
  test('rejects recovery for non-operational contracts', () => {
    const budget = new RecoveryBudget({
      intent: 'self_assessment',
      evidenceRequirement: 'internal_state',
      executionRequirement: 'llm_only',
      orchestrationOwner: 'ceo_lifecycle',
      maxTurns: 2,
      maxRecoveries: 0,
      latencyBudgetMs: 15000,
      toolRequired: false,
      subagentsRequired: false,
      reason: 'self assessment',
    })

    const result = budget.consume('auto_recovery')
    expect(result.allowed).toBe(false)
    expect(result.count).toBe(0)
    expect(result.reason).toContain('does not permit execution recovery')
  })

  test('allows only the declared number of operational recoveries', () => {
    const contract = {
      intent: 'tool_action' as const,
      evidenceRequirement: 'internal_state' as const,
      executionRequirement: 'one_tool' as const,
      orchestrationOwner: 'operational_orchestrator' as const,
      maxTurns: 4,
      maxRecoveries: 1,
      latencyBudgetMs: 30000,
      toolRequired: true,
      subagentsRequired: false,
      reason: 'tool action',
    }
    const budget = new RecoveryBudget(contract)
    expect(budget.consume('auto_recovery').allowed).toBe(true)
    const second = budget.consume('auto_recovery')
    expect(second.allowed).toBe(false)
    expect(second.count).toBe(1)
    expect(budget.remaining).toBe(0)
  })

  test('classifies orchestrator recovery events without treating normal thoughts as recovery', () => {
    expect(recoveryEventFromMessage('[AUTO-RECOVERY] Detected "promise without action". Forcing execution now...')).toBe('auto_recovery')
    expect(recoveryEventFromMessage('[AUTO-RECOVERY] Detected stuck condition. Auto-continuing...')).toBe('auto_recovery')
    expect(recoveryEventFromMessage('Working on the next step.')).toBeNull()
    const events: RecoveryEvent[] = ['auto_recovery', 'provider_failure', 'tool_failure', 'quality_failure', 'timeout_risk']
    expect(events).toHaveLength(5)
  })
})
