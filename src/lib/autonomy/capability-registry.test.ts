import { describe, expect, test } from 'bun:test'
import { getCapabilityMetadata, listCapabilityMetadata } from './capability-registry'
import { classifyToolExecution } from './autonomy-runtime'

describe('Capability-aware autonomy registry', () => {
  test('research capability is explicitly autonomous-safe', () => {
    const metadata = getCapabilityMetadata('web_search')
    expect(metadata?.capability).toBe('RESEARCH.READ')
    expect(metadata?.autonomousEligible).toBe(true)
    expect(metadata?.externalSideEffect).toBe(false)
  })

  test('external communication is never classified as autonomous-safe', () => {
    const metadata = getCapabilityMetadata('send_email')
    expect(metadata?.capability).toBe('COMMUNICATION.EXTERNAL_SEND')
    expect(metadata?.autonomousEligible).toBe(false)
    const decision = classifyToolExecution('send_email', { to: 'x@example.com' }, { confidence: 1 })
    expect(decision.autonomous).toBe(false)
    expect(decision.requiresOwnerApproval).toBe(true)
  })

  test('financial capability requires approval', () => {
    const metadata = getCapabilityMetadata('stripe_payment_processor')
    expect(metadata?.affectsFinancialState).toBe(true)
    const decision = classifyToolExecution('stripe_payment_processor', { amount: 10 }, { confidence: 1 })
    expect(decision.autonomous).toBe(false)
    expect(decision.requiresOwnerApproval).toBe(true)
  })

  test('arbitrary code execution is security-sensitive and not autonomous', () => {
    const metadata = getCapabilityMetadata('code_exec')
    expect(metadata?.capability).toBe('DEVELOPMENT.EXECUTE_CODE')
    expect(metadata?.affectsSecurity).toBe(true)
    expect(metadata?.autonomousEligible).toBe(false)
    const decision = classifyToolExecution('code_exec', { code: 'return 1' }, { confidence: 1 })
    expect(decision.autonomous).toBe(false)
    expect(decision.requiresOwnerApproval).toBe(true)
  })

  test('unknown tools remain conservative and cannot inherit autonomy', () => {
    const decision = classifyToolExecution('future_unregistered_writer', { content: 'x' }, { confidence: 1 })
    expect(decision.autonomous).toBe(false)
    expect(decision.requiresOwnerApproval).toBe(true)
  })

  test('every registered capability has a complete side-effect contract', () => {
    for (const [toolName, metadata] of Object.entries(listCapabilityMetadata())) {
      expect(metadata.capability.length).toBeGreaterThan(0)
      expect(typeof metadata.reversible).toBe('boolean')
      expect(typeof metadata.externalSideEffect).toBe('boolean')
      expect(typeof metadata.affectsProduction).toBe('boolean')
      expect(typeof metadata.affectsSecurity).toBe('boolean')
      expect(typeof metadata.affectsFinancialState).toBe('boolean')
      expect(typeof metadata.containsPersonalData).toBe('boolean')
      expect(typeof metadata.autonomousEligible).toBe('boolean')
      expect(toolName.length).toBeGreaterThan(0)
    }
  })
})
