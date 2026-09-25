import { describe, expect, test } from 'bun:test'
import { buildSemanticQualityReport, buildSemanticRepairPlan, renderSemanticRepairPrompt } from '@/lib/ceo-semantic-quality-report'
import type { QualityResult, StructuralQualitySummary } from '@/lib/ceo-cognitive-contract'
import type { ConversationDecisionContract } from '@/lib/ceo-conversation-decision-contract'
import type { ConversationQualityScore } from '@/lib/ceo-response-quality-gate'

function quality(overrides: Partial<QualityResult> = {}): QualityResult {
  return { decision: 'PASS', evidenceState: 'NOT_APPLICABLE', verificationStatus: 'not_required', checks: { nonEmpty: true, contractValid: true, objectiveCoverage: true, internalConsistency: true, evidenceDiscipline: true, actionableStructure: true }, reasons: [], ...overrides }
}
function structural(overrides: Partial<StructuralQualitySummary> = {}): StructuralQualitySummary {
  return { applicable: true, claimCoverage: 1, claimCoverageOk: true, representedSectionCount: 3, contradictionFlaggedUpstream: true, contradictionPreserved: true, sourceAttributionPresent: true, sourceCoverageComplete: true, ...overrides }
}
function cq(overrides: Partial<ConversationQualityScore> = {}): ConversationQualityScore {
  return { score: 90, continuity: 90, relevance: 88, naturalness: 92, toneAlignment: 90, coherence: 91, nonRepetition: 95, initiative: 80, referenceResolution: 90, personalityConsistency: 92, progression: 85, issues: [], ...overrides }
}
function contract(overrides: Partial<ConversationDecisionContract> = {}): ConversationDecisionContract {
  return { schemaVersion: 3, meaning: 'what is the plan', intent: 'conversation', speechAct: 'question', completeness: 'complete', conversationRelation: 'new', cognitiveDepth: 'contextual', responseRegister: 'conversational', responseAction: 'answer', comprehensionMode: 'conversation', toolRequirement: 'none', evidenceRequirement: 'none', clarificationRequired: false, confidence: 0.9, uncertainty: [], rationale: [], ...overrides }
}

describe('SemanticQualityReport and SemanticRepairPlan', () => {
  test('a genuinely good response with a satisfied contract passes with no failed dimensions', () => {
    const report = buildSemanticQualityReport({ quality: quality(), conversationQuality: cq(), contract: contract(), content: 'Here is the plan: we focus on reference resolution first.' })
    expect(report.decision).toBe('PASS')
    expect(report.failedDimensions).toEqual([])
  })

  test('a weak reference-resolution dimension triggers REPAIR with a correctly targeted, priority-ordered plan', () => {
    const report = buildSemanticQualityReport({ quality: quality(), conversationQuality: cq({ referenceResolution: 30 }), contract: contract({ meaning: 'what about the second one', conversationRelation: 'continuation' }), content: 'It depends on the situation.' })
    expect(report.decision).toBe('REPAIR')
    expect(report.failedDimensions).toEqual(['referenceResolution'])
    expect(report.repairPriority).toEqual(['referenceResolution'])
    const plan = buildSemanticRepairPlan(report)
    expect(plan.maxAttempts).toBe(1)
    expect(plan.repairInstructions[0]).toContain('Resolve the reference')
    expect(plan.preserveDimensions).not.toContain('referenceResolution')
    expect(plan.preserveDimensions).toContain('naturalness')
  })

  test('a genuine evidence overclaim forces DEGRADE regardless of how well every other dimension scores', () => {
    const report = buildSemanticQualityReport({
      quality: quality({ decision: 'ESCALATE', checks: { nonEmpty: true, contractValid: true, objectiveCoverage: true, internalConsistency: true, evidenceDiscipline: false, actionableStructure: true }, failureReason: 'evidence_insufficient' }),
      conversationQuality: cq(),
      contract: contract({ intent: 'research', evidenceRequirement: 'required' }),
      content: 'Yes, I verified this live.',
    })
    expect(report.decision).toBe('DEGRADE')
  })

  // Deep-audit finding: false_completion_claim and internal_artifact_leak used to be indistinguishable
  // from an ordinary phrasing miss under the generic 'quality_failure' reason, so this function's own
  // isGenuineOverclaim (a second, independently-drifting copy of the same list ceo-cognitive-lifecycle.ts
  // keeps for soft-pass eligibility) never forced DEGRADE for them -- a false completion claim or a
  // leaked artifact could be sent through a "repair the specific issues" pass that might just as easily
  // produce a more polished version of the same violation, instead of being rejected outright.
  test('a false completion claim forces DEGRADE regardless of how well every other dimension scores', () => {
    const report = buildSemanticQualityReport({
      quality: quality({ decision: 'ESCALATE', failureReason: 'false_completion_claim' }),
      conversationQuality: cq(),
      contract: contract({ intent: 'decision', responseAction: 'execute' }),
      content: 'I have already deployed this to production.',
    })
    expect(report.decision).toBe('DEGRADE')
  })

  test('a leaked internal artifact forces DEGRADE regardless of how well every other dimension scores', () => {
    const report = buildSemanticQualityReport({
      quality: quality({ decision: 'ESCALATE', failureReason: 'internal_artifact_leak' }),
      conversationQuality: cq(),
      contract: contract({ intent: 'analysis', responseAction: 'answer' }),
      content: 'The architecture is strong. [continuous_loop_trace] hidden telemetry.',
    })
    expect(report.decision).toBe('DEGRADE')
  })

  test('a clarify action that never actually asks anything fails contractSatisfied and triggers REPAIR even with strong scores', () => {
    const report = buildSemanticQualityReport({
      quality: quality(),
      conversationQuality: cq(),
      contract: contract({ meaning: 'we should do it', completeness: 'partial', responseAction: 'clarify', clarificationRequired: true }),
      content: 'Sounds good, I will proceed.',
    })
    expect(report.decision).toBe('REPAIR')
    expect(report.contractSatisfied).toBe(false)
    const plan = buildSemanticRepairPlan(report)
    expect(plan.repairInstructions[0]).toContain('did not fulfill what was actually asked')
  })

  test('a clarify action that does ask a real question satisfies the contract', () => {
    const report = buildSemanticQualityReport({ quality: quality(), conversationQuality: cq(), contract: contract({ completeness: 'partial', responseAction: 'clarify', clarificationRequired: true }), content: 'Which of the two options did you mean?' })
    expect(report.contractSatisfied).toBe(true)
  })

  test('the repair prompt is targeted, not a full rewrite request, and includes the evidence constraint', () => {
    const report = buildSemanticQualityReport({ quality: quality(), conversationQuality: cq({ naturalness: 40 }), contract: contract(), content: 'Draft answer.' })
    const plan = buildSemanticRepairPlan(report)
    const prompt = renderSemanticRepairPrompt('the objective', 'Draft answer.', plan)
    expect(prompt.content).toContain('targeted repair, not a full rewrite')
    expect(prompt.content).toContain('Do not introduce any new factual claim')
    expect(prompt.content).toContain('Draft answer.')
  })
})

// Self-repair follow-up (2026-09-25), Option 2: ceo-structural-quality-gate.ts's contradictionPreserved
// finding is genuinely fixable by an escalation adding acknowledgment language (unlike claimCoverageOk,
// which is permanently unwinnable within a turn once sourceCoverageComplete is false -- see
// isFutileStructuralCoverageEscalation in ceo-cognitive-lifecycle.ts). These tests confirm it now flows
// through this same structured, priority-ordered repair mechanism instead of only the escalation loop's
// unstructured raw-reason-dump prompt, and confirm claimCoverageOk deliberately never does.
describe('SemanticQualityReport: structural contradiction preservation', () => {
  test('an unpreserved source contradiction triggers REPAIR as the top repair priority, even with perfect conversational scores', () => {
    const report = buildSemanticQualityReport({
      quality: quality({ decision: 'ESCALATE', structuralQuality: structural({ contradictionPreserved: false }) }),
      conversationQuality: cq(),
      contract: contract({ intent: 'analysis', responseAction: 'answer' }),
      content: 'The document reports Q3 revenue growth of 12%.',
    })
    expect(report.decision).toBe('REPAIR')
    expect(report.failedDimensions[0]).toBe('contradictionPreservation')
    expect(report.repairPriority[0]).toBe('contradictionPreservation')
  })

  test('the repair plan for an unpreserved contradiction carries a specific instruction and a no-silent-resolution constraint', () => {
    const report = buildSemanticQualityReport({
      quality: quality({ decision: 'ESCALATE', structuralQuality: structural({ contradictionPreserved: false }) }),
      conversationQuality: cq(),
      contract: contract({ intent: 'analysis', responseAction: 'answer' }),
      content: 'The document reports Q3 revenue growth of 12%.',
    })
    const plan = buildSemanticRepairPlan(report)
    expect(plan.repairInstructions[0]).toContain('did not acknowledge')
    expect(plan.evidenceConstraints.some((c) => c.includes('Do not resolve the contradiction'))).toBe(true)
  })

  test('a failureReason that is ALSO a genuine overclaim (claim_consistency_failure) still forces DEGRADE, not REPAIR, even with an unpreserved contradiction present', () => {
    const report = buildSemanticQualityReport({
      quality: quality({ decision: 'ESCALATE', failureReason: 'claim_consistency_failure', structuralQuality: structural({ contradictionPreserved: false }) }),
      conversationQuality: cq(),
      contract: contract({ intent: 'analysis' }),
      content: 'Some content.',
    })
    // claim_consistency_failure IS one of isGenuineOverclaim's reasons (it also covers ordinary
    // in-response claim contradictions) -- this confirms the structural finding does not accidentally
    // downgrade an otherwise-DEGRADE-worthy failure reason to REPAIR; DEGRADE still wins.
    expect(report.decision).toBe('DEGRADE')
  })

  test('a genuinely unresolved evidence gap still forces DEGRADE even when the contradiction WAS preserved', () => {
    const report = buildSemanticQualityReport({
      quality: quality({ decision: 'ESCALATE', checks: { nonEmpty: true, contractValid: true, objectiveCoverage: true, internalConsistency: true, evidenceDiscipline: false, actionableStructure: true }, failureReason: 'evidence_insufficient', structuralQuality: structural({ contradictionPreserved: true }) }),
      conversationQuality: cq(),
      contract: contract({ intent: 'research', evidenceRequirement: 'required' }),
      content: 'Verified live.',
    })
    expect(report.decision).toBe('DEGRADE')
  })

  test('no structural source model (applicable:false) never triggers the contradiction-repair path', () => {
    const report = buildSemanticQualityReport({
      quality: quality({ structuralQuality: structural({ applicable: false, contradictionPreserved: false }) }),
      conversationQuality: cq(),
      contract: contract(),
      content: 'An ordinary answer with nothing to repair.',
    })
    expect(report.decision).toBe('PASS')
    expect(report.failedDimensions).toEqual([])
  })

  test('incomplete claim coverage (claimCoverageOk:false) is deliberately NOT wired into this repair mechanism -- it is permanently unwinnable within a turn, unlike contradiction preservation', () => {
    const report = buildSemanticQualityReport({
      quality: quality({ structuralQuality: structural({ claimCoverageOk: false, sourceCoverageComplete: false, contradictionPreserved: true }) }),
      conversationQuality: cq(),
      contract: contract({ intent: 'analysis' }),
      content: 'A well-formed partial answer.',
    })
    expect(report.decision).toBe('PASS')
    expect(report.failedDimensions).not.toContain('contradictionPreservation')
  })
})
