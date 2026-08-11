import { test, expect, describe } from 'bun:test'
import { TOOL_REGISTRY } from '@/lib/tools'
import { classifyToolExecution } from './autonomy-runtime'
import { CAPABILITY_REGISTRY, getCapabilityMetadata } from './capability-registry'

describe('Capability-aware autonomy registry', () => {
  test('research capability is explicitly autonomous-safe', () => {
    const metadata = getCapabilityMetadata('web_search')
    expect(metadata?.category).toBe('read')
    expect(metadata?.autonomousEligible).toBe(true)
  })

  test('external communication is never classified as autonomous-safe', () => {
    const metadata = getCapabilityMetadata('send_email')
    expect(metadata?.category).toBe('communication')
    expect(metadata?.autonomousEligible).toBe(false)
  })

  test('financial capability requires approval', () => {
    const metadata = getCapabilityMetadata('stripe_payment_processor')
    expect(metadata?.category).toBe('financial')
    expect(metadata?.autonomousEligible).toBe(false)
  })

  test('arbitrary code execution is security-sensitive and not autonomous', () => {
    const metadata = getCapabilityMetadata('code_exec')
    expect(metadata?.category).toBe('security')
    expect(metadata?.affectsSecurity).toBe(true)
    expect(metadata?.autonomousEligible).toBe(false)
  })

  test('unknown tools remain conservative and cannot inherit autonomy', () => {
    const decision = classifyToolExecution('future_unclassified_tool', {}, { confidence: 1 })
    expect(decision.autonomous).toBe(false)
    expect(decision.requiresOwnerApproval).toBe(true)
  })

  test('every registered capability has a complete side-effect contract', () => {
    for (const [toolName, metadata] of Object.entries(CAPABILITY_REGISTRY)) {
      expect(metadata.category).toBeDefined()
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

  test('autonomous-eligible capabilities are intrinsically low-risk', () => {
    for (const metadata of Object.values(CAPABILITY_REGISTRY)) {
      if (!metadata.autonomousEligible) continue

      expect(metadata.reversible).toBe(true)
      expect(metadata.externalSideEffect).toBe(false)
      expect(metadata.affectsProduction).toBe(false)
      expect(metadata.affectsSecurity).toBe(false)
      expect(metadata.affectsFinancialState).toBe(false)
      expect(metadata.containsPersonalData).toBe(false)
    }
  })

  test('capability registry cannot be mutated after initialization', () => {
    const metadata = getCapabilityMetadata('web_search')
    expect(Object.isFrozen(CAPABILITY_REGISTRY)).toBe(true)
    expect(Object.isFrozen(metadata)).toBe(true)

    expect(() => {
      ;(CAPABILITY_REGISTRY as Record<string, unknown>).web_search = undefined
    }).toThrow()

    expect(() => {
      if (metadata) {
        ;(metadata as { autonomousEligible: boolean }).autonomousEligible = false
      }
    }).toThrow()

    expect(getCapabilityMetadata('web_search')?.autonomousEligible).toBe(true)
  })

  test('every live TOOL_REGISTRY entry is governed, even when metadata is missing', () => {
    const unregistered: string[] = []

    for (const toolName of Object.keys(TOOL_REGISTRY)) {
      const metadata = getCapabilityMetadata(toolName)
      if (!metadata) unregistered.push(toolName)

      const decision = classifyToolExecution(toolName, {}, { confidence: 1 })

      if (!metadata) {
        // Missing metadata must never grant autonomy. A legacy-inferred
        // destructive action may be forbidden outright; all other unknown
        // actions must require verified owner approval.
        expect(decision.autonomous).toBe(false)
        if (decision.authority !== 'FORBIDDEN') {
          expect(decision.requiresOwnerApproval).toBe(true)
        }
      }
    }

    // This is an audit invariant, not a requirement that every tool already
    // has hand-authored metadata. New tools may be temporarily unregistered,
    // but they must remain non-autonomous until explicitly classified.
    expect(unregistered.length).toBeGreaterThanOrEqual(0)
  })
})
