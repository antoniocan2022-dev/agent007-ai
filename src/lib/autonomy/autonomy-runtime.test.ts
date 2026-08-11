import { describe, expect, test } from 'bun:test'
import { classifyToolExecution, autonomyDenialMessage } from './autonomy-runtime'

describe('Runtime autonomy boundary', () => {
  test('allows read-only actions only when policy is explicitly approved', () => {
    const decision = classifyToolExecution('web_search', { query: 'Agent007' }, { policyApproved: true })
    expect(decision.authority).toBe('AUTONOMOUS_SAFE')
    expect(decision.autonomous).toBe(true)
  })

  test('escalates writes when policy approval is absent', () => {
    const decision = classifyToolExecution('file_write', { path: 'src/example.ts', content: 'x' })
    expect(decision.autonomous).toBe(false)
    expect(decision.authority).toBe('FORBIDDEN')
  })

  test('requires approval for financial actions with unknown cost', () => {
    const decision = classifyToolExecution('stripe_payment_processor', { currency: 'USD' }, { policyApproved: true, confidence: 1 })
    expect(decision.authority).toBe('HUMAN_APPROVAL')
    expect(decision.requiresOwnerApproval).toBe(true)
  })

  test('requires approval for deployment regardless of confidence', () => {
    const decision = classifyToolExecution('trigger_redeploy', {}, { policyApproved: true, confidence: 1 })
    expect(decision.authority).toBe('HUMAN_APPROVAL')
    expect(decision.requiresOwnerApproval).toBe(true)
  })

  test('forbids destructive actions and produces an actionable denial', () => {
    const decision = classifyToolExecution('file_delete', { path: 'tmp/example.txt' }, { policyApproved: true, confidence: 1 })
    expect(decision.authority).toBe('FORBIDDEN')
    expect(decision.autonomous).toBe(false)
    expect(autonomyDenialMessage('file_delete', decision)).toContain('FORBIDDEN')
  })

  test('requires approval for external communication', () => {
    const decision = classifyToolExecution('send_email', { to: 'owner@example.com', message: 'test' }, { policyApproved: true, confidence: 1 })
    expect(decision.authority).toBe('HUMAN_APPROVAL')
    expect(decision.requiresOwnerApproval).toBe(true)
  })
})
