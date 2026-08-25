import { describe, expect, test } from 'bun:test'
import { canActAutonomously, canActWithinGuardrail, evaluateVentureAction, resolveVentureActionEnvelope, validateVentureMandate } from '../src/lib/venture-mandate'

describe('CEO venture authority envelope', () => {
  test('mandate validates with exactly one authority tier per declared action', () => {
    expect(validateVentureMandate()).toEqual([])
  })

  test('autonomous low-risk actions remain autonomous', () => {
    const evaluation = evaluateVentureAction('internal_experiments', { requestedSpend: 5, monthlyCommittedSpend: 10 })
    expect(evaluation.allowed).toBe(true)
    expect(evaluation.requiresHumanApproval).toBe(false)
    expect(evaluation.envelope.riskClass).toBe('medium')
    expect(canActAutonomously('internal_experiments')).toBe(true)
  })

  test('guardrailed spend cannot exceed the single or monthly envelope', () => {
    expect(canActWithinGuardrail('small_operating_spend')).toBe(true)
    expect(evaluateVentureAction('small_operating_spend', { requestedSpend: 10, monthlyCommittedSpend: 90 }).allowed).toBe(true)
    const single = evaluateVentureAction('small_operating_spend', { requestedSpend: 11 })
    expect(single.allowed).toBe(false)
    expect(single.requiresHumanApproval).toBe(true)
    const monthly = evaluateVentureAction('small_operating_spend', { requestedSpend: 5, monthlyCommittedSpend: 96 })
    expect(monthly.allowed).toBe(false)
    expect(monthly.requiresHumanApproval).toBe(true)
  })

  test('refunds use the dedicated refund ceiling rather than the generic spend ceiling', () => {
    const envelope = resolveVentureActionEnvelope('refunds_within_limit')
    expect(envelope.maxSingleSpend).toBe(25)
    expect(evaluateVentureAction('refunds_within_limit', { requestedSpend: 25 }).allowed).toBe(true)
    expect(evaluateVentureAction('refunds_within_limit', { requestedSpend: 25.01 }).requiresHumanApproval).toBe(true)
  })

  test('high-impact lifecycle actions are owner-gated', () => {
    for (const action of ['launch_ready', 'scale', 'pivot', 'kill']) {
      const evaluation = evaluateVentureAction(action)
      expect(evaluation.allowed).toBe(false)
      expect(evaluation.requiresHumanApproval).toBe(true)
      expect(evaluation.envelope.irreversible).toBe(true)
      expect(evaluation.envelope.riskClass === 'high' || evaluation.envelope.riskClass === 'critical').toBe(true)
    }
  })

  test('unknown action fails closed to owner approval', () => {
    const evaluation = evaluateVentureAction('totally_unknown_action')
    expect(evaluation.allowed).toBe(false)
    expect(evaluation.requiresHumanApproval).toBe(true)
    expect(evaluation.envelope.authority).toBe('human_approval')
  })
})
