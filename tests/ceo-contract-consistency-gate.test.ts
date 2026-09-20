import { describe, expect, test } from 'bun:test'
import { enforceContractConsistency } from '@/lib/ceo-contract-consistency-gate'
import type { RequestedOperation } from '@/lib/ceo-cognitive-contract'
import type { SelfReflectionClassification } from '@/lib/ceo-self-reflection'

const NONE_REFLECTION: SelfReflectionClassification = {
  kind: 'none',
  isSelfReflective: false,
  reason: 'test fixture',
}

function check(input: {
  candidateIntent: 'conversation' | 'analysis' | 'production_action' | 'mission_action' | 'tool_action' | 'self_assessment'
  authoritativeInstruction: string
  sourceMaterialPresent: boolean
  selfAssessmentRequested?: boolean
  requestedOperation?: RequestedOperation
  candidateSelfReflection?: SelfReflectionClassification
}) {
  return enforceContractConsistency({
    candidateIntent: input.candidateIntent,
    candidateSelfReflection: input.candidateSelfReflection ?? NONE_REFLECTION,
    sourceMaterialPresent: input.sourceMaterialPresent,
    authoritativeInstruction: input.authoritativeInstruction,
    selfAssessmentRequested: input.selfAssessmentRequested ?? false,
    requestedOperation: input.requestedOperation ?? 'conversation',
  })
}

describe('CEO Source Authority Phase 4: contract-consistency gate', () => {
  test('authoritative self-assessment survives source-bearing turns', () => {
    const result = check({
      candidateIntent: 'self_assessment',
      authoritativeInstruction: 'Please give me a self-assessment of Agent007.',
      sourceMaterialPresent: true,
      selfAssessmentRequested: true,
      candidateSelfReflection: { kind: 'capability_assessment', isSelfReflective: true, reason: 'explicit' },
    })
    expect(result.effectiveIntent).toBe('self_assessment')
    expect(result.effectiveSelfReflection.isSelfReflective).toBe(true)
    expect(result.violations).toEqual([])
  })

  test('explicit self-assessment does not override an authoritative production command', () => {
    const result = check({
      candidateIntent: 'production_action',
      authoritativeInstruction: 'Please do a self-assessment, and deploy the approved release.',
      sourceMaterialPresent: true,
      selfAssessmentRequested: true,
      candidateSelfReflection: NONE_REFLECTION,
      requestedOperation: 'self_assessment',
    })
    expect(result.effectiveIntent).toBe('production_action')
    expect(result.violations).not.toContain('self_assessment_requires_authoritative_request')
  })

  test('canonical action operation preserves a legitimate passive production instruction', () => {
    const result = check({
      candidateIntent: 'production_action',
      authoritativeInstruction: 'I need the approved release deployed to production.',
      sourceMaterialPresent: true,
      requestedOperation: 'action',
    })
    expect(result.effectiveIntent).toBe('production_action')
    expect(result.violations).toEqual([])
  })

  test('source-tail research vocabulary cannot authorize external research', () => {
    const result = check({
      candidateIntent: 'research',
      authoritativeInstruction: 'Please give me a deep comprehension of this report.',
      sourceMaterialPresent: true,
      requestedOperation: 'document_comprehension',
    })
    expect(result.effectiveIntent).toBe('analysis')
    expect(result.violations).toContain('research_requires_authoritative_request')
  })

  test('an authoritative research request remains research on a source-bearing turn', () => {
    const result = check({
      candidateIntent: 'research',
      authoritativeInstruction: 'Please research the latest public information about this company.',
      sourceMaterialPresent: true,
      requestedOperation: 'research',
    })
    expect(result.effectiveIntent).toBe('research')
    expect(result.violations).toEqual([])
  })

  test('source-tail self-assessment is rejected by the generalized rule', () => {
    const result = check({
      candidateIntent: 'self_assessment',
      authoritativeInstruction: 'Please analyze this report.',
      sourceMaterialPresent: true,
      selfAssessmentRequested: false,
      candidateSelfReflection: { kind: 'capability_assessment', isSelfReflective: true, reason: 'source tail' },
      requestedOperation: 'document_comprehension',
    })
    expect(result.effectiveIntent).toBe('analysis')
    expect(result.effectiveSelfReflection.isSelfReflective).toBe(false)
    expect(result.violations).toContain('self_assessment_requires_authoritative_request')
  })

  test('production action from source vocabulary is rejected unless the authoritative instruction commands it', () => {
    const blocked = check({
      candidateIntent: 'production_action',
      authoritativeInstruction: 'Please analyze this report.',
      sourceMaterialPresent: true,
      requestedOperation: 'document_comprehension',
    })
    expect(blocked.effectiveIntent).toBe('analysis')
    expect(blocked.violations).toContain('production_action_requires_authoritative_command')

    const allowed = check({
      candidateIntent: 'production_action',
      authoritativeInstruction: 'Please deploy the approved release.',
      sourceMaterialPresent: true,
    })
    expect(allowed.effectiveIntent).toBe('production_action')
    expect(allowed.violations).toEqual([])
  })

  test('mission action from source vocabulary is rejected unless the authoritative instruction commands it', () => {
    const blocked = check({
      candidateIntent: 'mission_action',
      authoritativeInstruction: 'Please give me a deep comprehension of this report.',
      sourceMaterialPresent: true,
      requestedOperation: 'document_comprehension',
    })
    expect(blocked.effectiveIntent).toBe('analysis')
    expect(blocked.violations).toContain('mission_action_requires_authoritative_command')

    const allowed = check({
      candidateIntent: 'mission_action',
      authoritativeInstruction: 'Please execute the approved revenue recovery mission.',
      sourceMaterialPresent: true,
    })
    expect(allowed.effectiveIntent).toBe('mission_action')
    expect(allowed.violations).toEqual([])
  })

  test('tool action from source vocabulary is rejected unless the authoritative instruction commands it', () => {
    const blocked = check({
      candidateIntent: 'tool_action',
      authoritativeInstruction: 'Please review this report.',
      sourceMaterialPresent: true,
      requestedOperation: 'document_comprehension',
    })
    expect(blocked.effectiveIntent).toBe('analysis')
    expect(blocked.violations).toContain('tool_action_requires_authoritative_command')

    const allowed = check({
      candidateIntent: 'tool_action',
      authoritativeInstruction: 'Please update the approved pricing plan.',
      sourceMaterialPresent: true,
    })
    expect(allowed.effectiveIntent).toBe('tool_action')
  })

  test('production and tool actions remain allowed for source-free turns', () => {
    expect(check({
      candidateIntent: 'production_action',
      authoritativeInstruction: 'Deploy the approved release.',
      sourceMaterialPresent: false,
    }).effectiveIntent).toBe('production_action')
    expect(check({
      candidateIntent: 'tool_action',
      authoritativeInstruction: 'Update the approved pricing plan.',
      sourceMaterialPresent: false,
    }).effectiveIntent).toBe('tool_action')
  })

  test('the gate is idempotent for an already-consistent decision', () => {
    const input = {
      candidateIntent: 'production_action' as const,
      authoritativeInstruction: 'Please deploy the approved release.',
      sourceMaterialPresent: true,
    }
    const once = check(input)
    const twice = enforceContractConsistency({
      candidateIntent: once.effectiveIntent,
      candidateSelfReflection: once.effectiveSelfReflection,
      sourceMaterialPresent: true,
      authoritativeInstruction: input.authoritativeInstruction,
      selfAssessmentRequested: false,
      requestedOperation: 'conversation',
    })
    expect(twice.effectiveIntent).toBe('production_action')
    expect(twice.violations).toEqual([])
  })
})