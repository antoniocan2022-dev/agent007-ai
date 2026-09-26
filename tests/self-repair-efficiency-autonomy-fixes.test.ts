import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { buildSemanticQualityReport, buildSemanticRepairPlan } from '@/lib/ceo-semantic-quality-report'
import { evaluateCeoQuality } from '@/lib/ceo-response-quality-gate'
import { buildRecommendationRecord, assessDomainPredictionDrift, calculateRecommendationPredictionError } from '@/lib/ceo-outcome-learning'
import type { QualityResult, StructuralQualitySummary } from '@/lib/ceo-cognitive-contract'
import type { ConversationDecisionContract } from '@/lib/ceo-conversation-decision-contract'
import type { ConversationQualityScore } from '@/lib/ceo-response-quality-gate'
import type { EvidenceBundle, EvidenceSource } from '@/lib/ceo-evidence-bundle'

const ROOT = join(import.meta.dir, '..')
const readLib = (path: string) => readFileSync(join(ROOT, 'src/lib', path), 'utf-8')

function quality(overrides: Partial<QualityResult> = {}): QualityResult {
  return { decision: 'PASS', evidenceState: 'NOT_APPLICABLE', verificationStatus: 'NOT_REQUIRED', checks: { nonEmpty: true, contractValid: true, objectiveCoverage: true, internalConsistency: true, evidenceDiscipline: true, actionableStructure: true }, reasons: [], ...overrides }
}
function structural(overrides: Partial<StructuralQualitySummary> = {}): StructuralQualitySummary {
  return { applicable: true, claimCoverage: 1, claimCoverageOk: true, representedSectionCount: 3, contradictionFlaggedUpstream: false, contradictionPreserved: true, sourceAttributionPresent: true, sourceCoverageComplete: true, ...overrides }
}
function cq(overrides: Partial<ConversationQualityScore> = {}): ConversationQualityScore {
  return { score: 90, continuity: 90, relevance: 88, naturalness: 92, toneAlignment: 90, coherence: 91, nonRepetition: 95, initiative: 80, referenceResolution: 90, personalityConsistency: 92, progression: 85, issues: [], ...overrides }
}
function contract(overrides: Partial<ConversationDecisionContract> = {}): ConversationDecisionContract {
  return { schemaVersion: 3, meaning: 'what is the plan', intent: 'conversation', speechAct: 'question', completeness: 'complete', conversationRelation: 'new', cognitiveDepth: 'contextual', responseRegister: 'conversational', responseAction: 'answer', comprehensionMode: 'conversation', toolRequirement: 'none', evidenceRequirement: 'none', clarificationRequired: false, confidence: 0.9, uncertainty: [], rationale: [], behavioralPolicy: { modes: [] } as any, ...overrides }
}

describe('Self-repair follow-up (2026-09-26): Repair-1, semantic-repair intent allowlist', () => {
  test('research is a real allowlisted intent, but opinion (a CeoIntent-only value the contract can never carry) is not', () => {
    const lifecycle = readLib('ceo-cognitive-lifecycle.ts')
    expect(lifecycle).toContain("['conversation', 'decision', 'analysis', 'research'].includes(request.decisionContract.intent)")
    expect(lifecycle).not.toContain("['conversation', 'opinion', 'decision', 'analysis'].includes(request.decisionContract.intent)")
  })
})

describe('Self-repair follow-up (2026-09-26): Repair-2, sourceAttributionPresent opportunistic repair', () => {
  test('a missing source attribution alone (no other defect) never triggers REPAIR', () => {
    const report = buildSemanticQualityReport({
      quality: quality({ structuralQuality: structural({ sourceAttributionPresent: false }) }),
      conversationQuality: cq(),
      contract: contract({ intent: 'analysis' }),
      content: 'A well-formed, fully satisfactory answer.',
    })
    expect(report.decision).toBe('PASS')
    expect(report.failedDimensions).not.toContain('sourceAttributionPresent')
  })

  test('a missing source attribution rides along on a REPAIR already triggered by a real defect, at the lowest priority', () => {
    const report = buildSemanticQualityReport({
      quality: quality({ structuralQuality: structural({ sourceAttributionPresent: false, contradictionPreserved: false }) }),
      conversationQuality: cq(),
      contract: contract({ intent: 'analysis' }),
      content: 'The document reports growth.',
    })
    expect(report.decision).toBe('REPAIR')
    expect(report.failedDimensions).toContain('sourceAttributionPresent')
    // contradictionPreservation (the real, gating defect) stays ahead of the opportunistic one.
    expect(report.repairPriority[0]).toBe('contradictionPreservation')
    expect(report.repairPriority.at(-1)).toBe('sourceAttributionPresent')
    const plan = buildSemanticRepairPlan(report)
    expect(plan.repairInstructions.some((instruction) => instruction.includes('distinguish what the source states'))).toBe(true)
  })

  test('no structural source model (applicable:false) never triggers the source-attribution repair path', () => {
    const report = buildSemanticQualityReport({
      quality: quality({ structuralQuality: structural({ applicable: false, sourceAttributionPresent: false }) }),
      conversationQuality: cq(),
      contract: contract(),
      content: 'An ordinary answer.',
    })
    expect(report.decision).toBe('PASS')
    expect(report.failedDimensions).not.toContain('sourceAttributionPresent')
  })
})

describe('Self-repair follow-up (2026-09-26): Repair-3, escalation loop provider-error handling', () => {
  test('escalation increments only on a genuine content-repair attempt, and the loop bounds consecutive provider errors separately', () => {
    const lifecycle = readLib('ceo-cognitive-lifecycle.ts')
    expect(lifecycle).toContain('const MAX_ESCALATION_PROVIDER_ERROR_RETRIES = 2')
    expect(lifecycle).toContain('providerErrorAttempts += 1; if (providerErrorAttempts >= MAX_ESCALATION_PROVIDER_ERROR_RETRIES) break')
    // escalation now increments AFTER the call succeeds, not unconditionally before the try.
    expect(lifecycle).toContain('escalation += 1; final = escalated; output = escalated;')
  })
})

describe('Self-repair follow-up (2026-09-26): Repair-4, evidence mis-citation vs. absence', () => {
  const source: EvidenceSource = { id: 'S1-abc', url: 'https://example.com/report', title: 'Report', sourceType: 'article' as any, sourceTier: 2, retrievedAt: Date.now(), text: 'Revenue reached $10 million in Q3.', claimCandidates: [], provenance: [], publisher: 'Example', sourceFamily: 'example.com' }
  const bundle: EvidenceBundle = { scope: 'external_web', profile: 'general_research', createdAt: Date.now(), sources: [source], claims: [], freshness: { observedAt: Date.now(), maxAgeMs: 3_600_000 }, contextText: '', sufficient: true, contradictions: [] }

  test('an unsupported claim carries a nonzero sourceCount when evidence exists but does not topically/quantitatively match -- distinguishing mis-citation from absence', () => {
    const result = evaluateCeoQuality({
      objective: 'What was our revenue growth?',
      content: 'Our revenue grew 40% [S1-abc] according to the report.',
      path: 'full',
      intent: 'research',
      evidenceScope: 'external_web',
      evidenceFreshness: { observedAt: Date.now(), maxAgeMs: 3_600_000 },
      evidenceBundle: bundle,
      evidenceProvided: true,
    })
    expect(result.claimVerification?.length).toBeGreaterThan(0)
    const claim = result.claimVerification!.find((c) => !c.supported)
    expect(claim).toBeDefined()
    // The source exists (sourceCount > 0) -- it just didn't satisfy quantitative/topical matching for
    // THIS claim's own number (40%, not present in the source) -- exactly the mis-citation-not-absence
    // case tryDegraded's citationRepairPrompt path is meant to catch instead of a redundant re-search.
    expect(claim!.sourceCount).toBeGreaterThan(0)
  })

  test('tryDegraded tries a targeted citation repair against existing evidence before a full re-search when every unsupported claim already has a matched source', () => {
    const lifecycle = readLib('ceo-cognitive-lifecycle.ts')
    expect(lifecycle).toContain('const misattributionOnly = unsupportedClaims.length > 0 && unsupportedClaims.every((claim) => claim.sourceCount > 0)')
    expect(lifecycle).toContain("console.log('[ceo-citation-repair]'")
  })

  test('the degraded-mode fallback names the specific unsupported claim(s) instead of a generic sentence', () => {
    const degradedMode = readLib('ceo-degraded-mode.ts')
    expect(degradedMode).toContain("recoveredCapability === 'evidence' && input.unsupportedClaims?.length")
  })
})

describe('Self-repair follow-up (2026-09-26): Autonomy-1, outcome-closure wired into the production heartbeat', () => {
  test('venture-operation-loop.ts closes open recommendations against the sustained-outcome assessment it already computed', () => {
    const loop = readLib('venture-operation-loop.ts')
    expect(loop).toContain('listOpenRecommendationsForVenture')
    expect(loop).toContain('closeRecommendationWithSustainedOutcome({ recommendationId: recommendation.recommendationId, ventureId })')
  })
})

describe('Self-repair follow-up (2026-09-26): Autonomy-2, mission-tick outputs routed through governance', () => {
  test('the strategy-pivot output is recorded into the CEO recommendation ledger', () => {
    const engine = readLib('max-autonomy-engine.ts')
    expect(engine).toContain("recordCeoRecommendation, generateRecommendationCorrelationId } = await import('./ceo-outcome-learning')")
  })
  test('the owner Telegram notification is wrapped in the execution-receipt audit trail, deliberately without the full authority gate', () => {
    const engine = readLib('max-autonomy-engine.ts')
    expect(engine).toContain("startMandatoryExecution, completeMandatoryExecution } = await import('./execution-contract')")
    expect(engine).toContain('actorId: \'max-autonomy-engine:strategy-pivot\'')
  })
})

describe('Self-repair follow-up (2026-09-26): Autonomy-3, real ActionClass evidence beyond LOW_RISK', () => {
  test('every governed tool call records graduation evidence under its classified ActionClass', () => {
    const toolsRuntime = readLib('tools-runtime.ts')
    expect(toolsRuntime).toContain('classifyToolExecutionDetailed')
    expect(toolsRuntime).toContain("import('./autonomy-graduation').then(({ recordAutonomyEvidence }) => recordAutonomyEvidence({")
  })
  test('the heartbeat evaluates graduation for every action class, not only LOW_RISK', () => {
    const loop = readLib('venture-operation-loop.ts')
    expect(loop).toContain("for (const otherClass of ['OBSERVE', 'MEDIUM_RISK', 'HIGH_RISK', 'IRREVERSIBLE'] as const)")
  })
})

describe('Self-repair follow-up (2026-09-26): Autonomy-4, reviewAt scheduling', () => {
  test('a decide-class recommendation gets a real reviewAt window; a recommend-class one does not', () => {
    const now = Date.now()
    const decide = buildRecommendationRecord({ correlationId: 'c1', objective: 'Should we do X?', responseAction: 'decide', recordedAt: now })
    const recommend = buildRecommendationRecord({ correlationId: 'c2', objective: 'What should we do about X?', responseAction: 'recommend', recordedAt: now })
    expect(decide.reviewAt).toBe(now + 14 * 24 * 60 * 60_000)
    expect(recommend.reviewAt).toBeNull()
  })
  test('an explicit reviewAt override (including an explicit null) is always respected', () => {
    const now = Date.now()
    const explicit = buildRecommendationRecord({ correlationId: 'c3', objective: 'Should we do X?', responseAction: 'decide', recordedAt: now, reviewAt: now + 1000 })
    const explicitNull = buildRecommendationRecord({ correlationId: 'c4', objective: 'Should we do X?', responseAction: 'decide', recordedAt: now, reviewAt: null })
    expect(explicit.reviewAt).toBe(now + 1000)
    expect(explicitNull.reviewAt).toBeNull()
  })
})

describe('Self-repair follow-up (2026-09-26): Autonomy-5, domain-scoped prediction drift', () => {
  test('domain is threaded through buildRecommendationRecord and normalized (trimmed, empty -> null)', () => {
    const withDomain = buildRecommendationRecord({ correlationId: 'c5', objective: 'obj', responseAction: 'recommend', domain: ' public_equity ' })
    const withoutDomain = buildRecommendationRecord({ correlationId: 'c6', objective: 'obj', responseAction: 'recommend' })
    expect(withDomain.domain).toBe('public_equity')
    expect(withoutDomain.domain).toBeNull()
  })
  test('a domain of "none" or "unknown" or empty never triggers assessment (fails closed with no signal)', async () => {
    expect((await assessDomainPredictionDrift('none')).recommendedAdjustment).toBe('none')
    expect((await assessDomainPredictionDrift('unknown')).recommendedAdjustment).toBe('none')
    expect((await assessDomainPredictionDrift('  ')).recommendedAdjustment).toBe('none')
  })
  test('an unavailable database fails closed to an empty, non-throwing assessment', async () => {
    const result = await assessDomainPredictionDrift('public_equity')
    expect(result.domain).toBe('public_equity')
    expect(result.recommendedAdjustment).toBe('none')
    expect(Number.isFinite(result.assessedAt)).toBe(true)
  })
  test('calculateRecommendationPredictionError still works given a domain-carrying recommendation', () => {
    const recommendation = buildRecommendationRecord({ correlationId: 'c7', objective: 'Forecast Q3 revenue', responseAction: 'decide', predictedOutcome: 'Revenue will reach $10 million.', domain: 'public_equity' })
    const error = calculateRecommendationPredictionError(recommendation, { outcomeId: 'o1', recommendationId: 'c7', observedOutcome: 'actual', actualResult: 'Revenue reached $8 million.', observedAt: Date.now(), source: 'test', metadata: {} })
    expect(error?.direction).toBe('worse_than_predicted')
  })
  test('the hot request path reads the domain confidence signal narrowly (real domain + non-none evidence requirement) and never gates, only advises', () => {
    const lifecycle = readLib('ceo-cognitive-lifecycle.ts')
    expect(lifecycle).toContain("if (domain === 'none' || domain === 'unknown' || decisionPlan.executionContract.evidenceRequirement === 'none') return []")
    expect(lifecycle).toContain('DOMAIN TRACK-RECORD SIGNAL (INTERNAL)')
  })
  test('the heartbeat persists a domain confidence signal for every domain that has ever produced a recommendation', () => {
    const loop = readLib('venture-operation-loop.ts')
    expect(loop).toContain('listDomainsWithRecommendations, assessDomainPredictionDrift, persistDomainConfidenceSignal')
  })
})

describe('Self-repair follow-up (2026-09-26): efficiency fixes are real, not cosmetic', () => {
  test('Eff-1: the two independent judge checks run concurrently via Promise.all', () => {
    const lifecycle = readLib('ceo-cognitive-lifecycle.ts')
    expect(lifecycle).toContain('const [semanticCheck, semanticContinuity] = await Promise.all([')
    expect(lifecycle).toContain('const settled = await Promise.allSettled(candidates.map((provider) => probeProvider(provider,')
  })
  test('Eff-2: an attempted-but-empty evidence recovery gets an explicit hedge instruction instead of silence', () => {
    const lifecycle = readLib('ceo-cognitive-lifecycle.ts')
    expect(lifecycle).toContain('NO RECOVERABLE EVIDENCE (INTERNAL)')
  })
  test('Eff-3: primary generation reserves a recovery-time floor when Phase 3 document coverage is incomplete', () => {
    const lifecycle = readLib('ceo-cognitive-lifecycle.ts')
    expect(lifecycle).toContain('const RESERVED_RECOVERY_FLOOR_MS = 20_000')
    expect(lifecycle).toContain('const documentCoverageIncomplete = structuralSourceModel !== undefined && structuralSourceModel.coverageComplete === false')
  })
  test('Eff-4: provider-standing cache TTL was raised, and quality-gate tokenization is memoized', () => {
    const providerStanding = readLib('provider-standing.ts')
    expect(providerStanding).toContain('const CACHE_TTL_MS = 15_000')
    const qualityGate = readLib('ceo-response-quality-gate.ts')
    expect(qualityGate).toContain('const normalizeCache = new Map<string, string[]>()')
  })
})
