import { describe, expect, test } from 'bun:test'
import { buildCeoDegradedResponse } from '@/lib/ceo-degraded-mode'
import { assertUserFacingText, classifyCeoBehavioralModes, containsInternalArtifactToken, buildCeoBehavioralPolicy } from '@/lib/ceo-behavioral-policy'
import { filterConversationalMemories, isConversationalMemoryVisible } from '@/lib/ceo-memory-visibility'
import { composeCeoResponse } from '@/lib/ceo-response-composer'
import { evaluateCeoQuality } from '@/lib/ceo-response-quality-gate'
import { renderConversationDecisionContract, type ConversationDecisionContract } from '@/lib/ceo-conversation-decision-contract'

describe('CEO P0-P5 runtime integrity', () => {
  test('P0 memory boundary blocks loop telemetry while preserving legitimate memory', () => {
    expect(isConversationalMemoryVisible({ key: 'continuous_loop_trace:abc', category: 'continuous_loop_trace' })).toBe(false)
    expect(isConversationalMemoryVisible({ key: 'runtime_telemetry:abc', category: 'runtime_telemetry' })).toBe(false)
    expect(isConversationalMemoryVisible({ key: 'user_goal:agent007', category: 'general' })).toBe(true)
    expect(filterConversationalMemories([
      { key: 'continuous_loop_trace:abc', category: 'continuous_loop_trace' },
      { key: 'user_goal:agent007', category: 'general' },
    ])).toHaveLength(1)
  })

  test('P0 user-facing boundary rejects internal artifact payloads', () => {
    const leaked = 'Answer\n1. [continuous_loop_trace] continuous_loop:abc { currentStage: "PERCEIVE" }'
    expect(containsInternalArtifactToken(leaked)).toBe(true)
    expect(assertUserFacingText(leaked)).toBe('')
  })

  test('P0 degraded answer does not substitute a prior business recommendation for a fresh question', async () => {
    const result = await buildCeoDegradedResponse({
      objective: 'Analyze the psychological or behavioral patterns affecting my decisions.',
      intent: 'analysis',
      responseAction: 'answer',
      reason: 'quality failure',
      failureReason: 'quality_failure',
      priorConversation: [
        { role: 'user', content: 'What should we prioritize next?', createdAt: 1 },
        { role: 'assistant', content: 'Prioritize the operating foundation before adding complexity.', createdAt: 2 },
      ],
      recall: async () => [{ key: 'prior', value: 'Prioritize the operating foundation before adding complexity.', category: 'general', createdAt: 1, score: 50, timesRecalled: 0 }],
    })
    expect(result.content).toContain('specific request')
    expect(result.content).not.toContain('Prioritize the operating foundation')
  })

  test('P1 degraded recovery preserves explicit response actions', async () => {
    const challenge = await buildCeoDegradedResponse({ objective: 'Challenge my assumption about adding more tools.', intent: 'opinion', responseAction: 'challenge', reason: 'quality failure', failureReason: 'quality_failure' })
    const explain = await buildCeoDegradedResponse({ objective: 'Explain why the architecture matters.', intent: 'analysis', responseAction: 'explain', reason: 'quality failure', failureReason: 'quality_failure' })
    expect(challenge.content).toContain('challenge path')
    expect(explain.content).toContain('explanation you asked for')
  })

  test('P1 corrections preserve the corrected direction without using stale memory', async () => {
    const result = await buildCeoDegradedResponse({
      objective: 'No, I meant operations kit should come first instead.',
      intent: 'decision',
      responseAction: 'answer',
      reason: 'quality failure',
      failureReason: 'quality_failure',
      priorConversation: [{ role: 'user', content: 'Prioritize revenue recovery first.', createdAt: 1 }],
      recall: async () => [{ key: 'stale', value: 'Revenue recovery should remain first.', category: 'general', createdAt: 1, score: 99, timesRecalled: 0 }],
    })
    expect(result.content.toLowerCase()).toContain('operations kit')
    expect(result.content).not.toContain('Revenue recovery should remain first')
  })

  test('P2 response composer strips internal telemetry while preserving safe user content', () => {
    const content = 'Useful answer\n[continuous_loop_trace] continuous_loop:abc { status: "ACTIVE" }'
    const quality = { decision: 'PASS' as const, evidenceState: 'NOT_APPLICABLE' as const, verificationStatus: 'NOT_REQUIRED' as const, checks: { nonEmpty: true, contractValid: true, objectiveCoverage: true, internalConsistency: true, evidenceDiscipline: true, actionableStructure: true }, reasons: [] }
    const rendered = composeCeoResponse({ content, evidenceState: 'NOT_APPLICABLE', quality, degraded: false, conversational: true })
    expect(containsInternalArtifactToken(rendered)).toBe(false)
    expect(rendered).toBe('Useful answer')
  })

  test('P2 rejects stale substitution even when the fresh objective is conversational', () => {
    const quality = evaluateCeoQuality({
      objective: 'What psychological patterns are affecting my decisions?',
      content: 'We should prioritize the operating foundation before adding complexity.',
      path: 'full',
      intent: 'conversation',
      responseAction: 'answer',
      priorTurns: [
        { role: 'user', content: 'What should we prioritize next?', createdAt: 1 },
        { role: 'assistant', content: 'Prioritize the operating foundation before adding complexity.', createdAt: 2 },
      ],
    })
    expect(quality.decision).not.toBe('PASS')
    expect(quality.reasons.some((reason) => /prior objective|stale|current objective/i.test(reason))).toBe(true)
  })

  test('P2 exposes all canonical response-integrity verdicts', () => {
    const stale = evaluateCeoQuality({
      objective: 'Analyze the psychological patterns affecting my decisions.',
      content: 'We should prioritize the operating foundation before adding complexity.',
      path: 'full',
      intent: 'analysis',
      responseAction: 'answer',
      priorTurns: [
        { role: 'user', content: 'What should we prioritize next?', createdAt: 1 },
        { role: 'assistant', content: 'Prioritize the operating foundation before adding complexity.', createdAt: 2 },
      ],
    })
    expect(stale.responseIntegrity).toEqual(expect.objectContaining({
      currentObjectiveMatch: false,
      requestedActionSatisfied: false,
      crossObjectiveSubstitution: true,
      internalArtifactLeakage: false,
    }))
    expect(stale.responseIntegrity?.staleResponseLikelihood).toBeGreaterThanOrEqual(0)

    const leaked = evaluateCeoQuality({
      objective: 'Explain the architecture.',
      content: 'The architecture is strong. [continuous_loop_trace] hidden telemetry.',
      path: 'full',
      intent: 'analysis',
      responseAction: 'explain',
    })
    expect(leaked.responseIntegrity?.internalArtifactLeakage).toBe(true)
    expect(leaked.decision).not.toBe('PASS')
  })

  test('P2 does not accept action keywords alone as proof that the requested action was satisfied', () => {
    const recommendation = evaluateCeoQuality({
      objective: 'Recommend whether we should add a second provider.',
      content: 'You should think about reliability. The system could recommend adding a second provider later.',
      path: 'full',
      intent: 'decision',
      responseAction: 'recommend',
    })
    const execution = evaluateCeoQuality({
      objective: 'Update the production configuration now.',
      content: 'Done would be the right outcome, but I did not perform the update.',
      path: 'full',
      intent: 'tool_action',
      responseAction: 'execute',
      externalExecutionSucceeded: false,
    })
    expect(recommendation.decision).not.toBe('PASS')
    expect(execution.decision).not.toBe('PASS')
  })

  test('P2 accepts explicit truthful outcomes for verify and execute without lucky wording', () => {
    const verified = evaluateCeoQuality({
      objective: 'Verify whether the repository is on the expected commit.',
      content: 'I checked the repository state and verified that the expected commit is present.',
      path: 'fast',
      intent: 'research',
      responseAction: 'verify',
      evidenceProvided: true,
      evidenceScope: 'live_system',
      evidenceFreshness: { observedAt: Date.now(), maxAgeMs: 60_000 },
    })
    const executed = evaluateCeoQuality({
      objective: 'Update the configuration now.',
      content: 'The requested configuration update was completed successfully.',
      path: 'fast',
      intent: 'tool_action',
      responseAction: 'execute',
      externalExecutionSucceeded: true,
    })
    expect(verified.decision).toBe('PASS')
    expect(executed.decision).toBe('PASS')
  })

  test('P3 canonical decision contract renders the differentiated behavioral policy for generation', () => {
    const policy = buildCeoBehavioralPolicy({ intent: 'opinion', responseAction: 'challenge', currentMessage: 'Challenge my assumptions about the business strategy.' })
    const contract = {
      schemaVersion: 3,
      meaning: 'challenge business strategy assumptions',
      intent: 'opinion',
      speechAct: 'question',
      completeness: 'complete',
      conversationRelation: 'new',
      cognitiveDepth: 'strategic',
      responseRegister: 'strategic',
      responseAction: 'challenge',
      toolRequirement: 'none',
      evidenceRequirement: 'possible',
      clarificationRequired: false,
      confidence: 0.92,
      uncertainty: [],
      rationale: ['behavioral policy is canonical'],
      behavioralPolicy: policy,
    } satisfies ConversationDecisionContract
    const rendered = renderConversationDecisionContract(contract)
    expect(rendered).toContain('CEO BEHAVIORAL POLICY (authoritative, internal)')
    expect(rendered).toContain('Current-objective match required: yes')
    expect(rendered).toContain('Generic recovery allowed: no')
    expect(rendered).toContain('Internal artifacts user-visible: no')
  })

  test('P3 CEO behavioral policy activates differentiated modes without creating separate engines', () => {
    expect(classifyCeoBehavioralModes({ intent: 'analysis', responseAction: 'answer', currentMessage: 'Analyze the current technical architecture and its biggest risk.' })).toEqual(expect.arrayContaining(['technologist']))
    expect(classifyCeoBehavioralModes({ intent: 'analysis', responseAction: 'answer', currentMessage: 'What psychological patterns might be affecting my decisions?' })).toEqual(expect.arrayContaining(['psychological_insight']))
    expect(classifyCeoBehavioralModes({ intent: 'opinion', responseAction: 'challenge', currentMessage: 'Challenge my assumptions about the business strategy.' })).toEqual(expect.arrayContaining(['business_partner', 'great_thinker']))
    const policy = buildCeoBehavioralPolicy({ intent: 'decision', responseAction: 'recommend', currentMessage: 'What should we prioritize for the business next?' })
    expect(policy.requireCurrentObjectiveMatch).toBe(true)
    expect(policy.allowGenericRecovery).toBe(false)
    expect(policy.internalArtifactsUserVisible).toBe(false)
  })

  test('P4 safety invariant: internal artifact leakage remains blocked through the composed response surface', () => {
    const quality = { decision: 'DEGRADED' as const, evidenceState: 'PARTIAL_UNCONFIRMED' as const, verificationStatus: 'NOT_PERFORMED' as const, checks: { nonEmpty: true, contractValid: true, objectiveCoverage: false, internalConsistency: true, evidenceDiscipline: true, actionableStructure: true }, reasons: ['test'] }
    const rendered = composeCeoResponse({ content: '[continuous_loop_trace] hidden', evidenceState: 'PARTIAL_UNCONFIRMED', quality, degraded: true })
    expect(containsInternalArtifactToken(rendered)).toBe(false)
  })

  test('P5 repeated continuity-safe degradation never converts a current request into stale content', async () => {
    const objectives = [
      'What psychological patterns might be affecting my decisions?',
      'Analyze the biggest technical weakness in the architecture.',
      'What important business question should I be asking right now?',
    ]
    for (const objective of objectives) {
      const result = await buildCeoDegradedResponse({ objective, intent: 'analysis', responseAction: 'answer', reason: 'quality failure', failureReason: 'quality_failure', recall: async () => [{ key: 'stale', value: 'Prioritize the operating foundation before adding complexity.', category: 'general', createdAt: 1, score: 50, timesRecalled: 0 }] })
      expect(result.content).toContain('specific request')
      expect(result.content).not.toContain('Prioritize the operating foundation before adding complexity.')
    }
  })
})
