import { describe, expect, test } from 'bun:test'
import { buildSemanticQualityReport, buildSemanticRepairPlan, renderSemanticRepairPrompt } from '@/lib/ceo-semantic-quality-report'
import type { QualityResult } from '@/lib/ceo-cognitive-contract'
import type { ConversationDecisionContract } from '@/lib/ceo-conversation-decision-contract'
import type { ConversationQualityScore } from '@/lib/ceo-response-quality-gate'

function quality(overrides: Partial<QualityResult> = {}): QualityResult {
  return { decision: 'PASS', evidenceState: 'NOT_APPLICABLE', verificationStatus: 'not_required', checks: { nonEmpty: true, contractValid: true, objectiveCoverage: true, internalConsistency: true, evidenceDiscipline: true, actionableStructure: true }, reasons: [], ...overrides }
}
function cq(overrides: Partial<ConversationQualityScore> = {}): ConversationQualityScore {
  return { score: 90, continuity: 90, relevance: 88, naturalness: 92, toneAlignment: 90, coherence: 91, nonRepetition: 95, initiative: 80, referenceResolution: 90, personalityConsistency: 92, progression: 85, issues: [], ...overrides }
}
function contract(overrides: Partial<ConversationDecisionContract> = {}): ConversationDecisionContract {
  return { schemaVersion: 3, meaning: 'what is the plan', intent: 'conversation', speechAct: 'question', completeness: 'complete', conversationRelation: 'new', cognitiveDepth: 'contextual', responseRegister: 'conversational', responseAction: 'answer', toolRequirement: 'none', evidenceRequirement: 'none', clarificationRequired: false, confidence: 0.9, uncertainty: [], rationale: [], ...overrides }
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
