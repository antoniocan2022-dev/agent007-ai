import { describe, expect, test } from 'bun:test'
import { getCapabilityMetadata } from './capability-registry'
import { classifyToolExecution } from './autonomy-runtime'

describe('Capability-aware autonomy registry', () => {
  test('research capability is explicitly autonomous-safe', () => {
    const metadata = getCapabilityMetadata('web_search')
    expect(metadata?.capability).toBe('RESEARCH.READ')
    expect(metadata?.autonomousEligible).toBe(true)
    expect(metadata?.externalSideEffect).toBe(false)
  })

  test('external communication is never classified as an autonomous-safe capability', () => {
    const metadata = getCapabilityMetadata('send_email')
    expect(metadata?.capability).toBe('COMMUNICATION.EXTERNAL_SEND')
    expect(metadata?.autonomousEligible).toBe(false)
    const decision = classifyToolExecution('send_email', { to: 'x@example.com' }, { confidence: 1 })
    expect(decision.autonomous).toBe(false)
    expect(decision.requiresOwnerApproval).toBe(true)
  })

  test('financial capability requires a bounded cost and approval', () => {
    const metadata = getCapabilityMetadata('stripe_payment_processor')
    expect(metadata?.affectsFinancialState).toBe(true)
    const decision = classifyToolExecution('stripe_payment_processor', { amount: 10 }, { confidence: 1 })
    expect(decision.autonomous).toBe(false)
    expect(decision.requiresOwnerApproval).toBe(true)
  })

  test('unknown tools remain conservative and cannot inherit autonomy', () => {
    const decision = classifyToolExecution('future_unregistered_writer', { content: 'x' }, { confidence: 1 })
    expect(decision.autonomous).toBe(false)
    expect(decision.requiresOwnerApproval).toBe(true)
  })
})
