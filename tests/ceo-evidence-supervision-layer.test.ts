import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { db } from '../src/lib/db'
import { assessCeoSelfInspection, gatherCeoSelfInspectionEvidence } from '../src/lib/ceo-self-inspection'
import { startMandatoryExecution, completeMandatoryExecution } from '../src/lib/execution-contract'
import { getExecutionReceipt, getExecutionReceiptsForMission, getOpenExecutions, getExecutionFailures, getRecentExecutionOutcomes } from '../src/lib/proof-ledger'
import { recordCeoRecommendation, recordRecommendationReview, listRecommendationReviews, summarizeRecommendationLedger } from '../src/lib/ceo-outcome-learning'
import type { CanonicalConversationContext } from '../src/lib/ceo-cognitive-conversation'
import type { ConversationDecisionContract } from '../src/lib/ceo-conversation-decision-contract'

function fakeContext(overrides: Partial<CanonicalConversationContext> = {}): CanonicalConversationContext {
  return {
    schemaVersion: 1,
    currentMessage: overrides.currentMessage ?? 'Tell me about the plan.',
    meaning: 'Tell me about the plan.',
    semanticInterpretation: { schemaVersion: 1, meaning: 'Tell me about the plan.', confidence: 0.8, uncertainty: [], source: 'deterministic' },
    intentHint: overrides.intentHint ?? 'conversation',
    speechAct: 'question',
    cognitiveDepth: 'direct',
    referenceScope: 'none',
    references: [],
    worldModel: { schemaVersion: 1, workingTopic: '', subtopics: [], userGoals: [], decisions: [], commitments: [], openLoops: [], activeThreads: [], importantEntities: [], recentCorrections: [], durableMemoryKeys: [] },
    state: { schemaVersion: 5, topic: '', topicCandidates: [], entities: [], activeThreads: [], threads: [], unresolvedQuestions: [], decisions: [], decisionSignals: [], supersededDecisions: [], recentUserGoals: [], recentCorrections: [], tone: 'neutral', turnCount: 1, lastUserMessage: '', lastAssistantMessage: '', updatedAt: Date.now() },
    ...overrides,
  } as CanonicalConversationContext
}

function fakeContract(overrides: Partial<ConversationDecisionContract> = {}): ConversationDecisionContract {
  return {
    schemaVersion: 3,
    meaning: 'Tell me about the plan.',
    intent: 'conversation',
    speechAct: 'question',
    completeness: 'complete',
    conversationRelation: 'new',
    cognitiveDepth: 'direct',
    responseRegister: 'conversational',
    responseAction: 'answer',
    toolRequirement: 'none',
    evidenceRequirement: 'none',
    clarificationRequired: false,
    confidence: 0.8,
    uncertainty: [],
    rationale: [],
    behavioralPolicy: { modes: ['friend'], requireCurrentObjectiveMatch: true, allowGenericRecovery: false, internalArtifactsUserVisible: false },
    ...overrides,
  } as ConversationDecisionContract
}

describe('assessCeoSelfInspection (pure)', () => {
  test('plain conversation with no self-referential signal does not warrant inspection', () => {
    const decision = assessCeoSelfInspection(fakeContext({ currentMessage: 'What is the weather like today?' }), fakeContract())
    expect(decision.inspect).toBe(false)
    expect(decision.questions).toEqual([])
  })

  test('self_assessment intent always warrants inspection', () => {
    const decision = assessCeoSelfInspection(fakeContext({ intentHint: 'self_assessment' }), fakeContract())
    expect(decision.inspect).toBe(true)
    expect(decision.questions).toContain('What is my current, real state?')
  })

  test('a recommend response action warrants inspection even with no history-referencing words', () => {
    const decision = assessCeoSelfInspection(fakeContext({ currentMessage: 'What should we prioritize next quarter?' }), fakeContract({ responseAction: 'recommend' }))
    expect(decision.inspect).toBe(true)
    expect(decision.questions).toContain('Have I already recommended or decided this, and what happened?')
  })

  test('a decide response action warrants inspection', () => {
    const decision = assessCeoSelfInspection(fakeContext(), fakeContract({ responseAction: 'decide' }))
    expect(decision.inspect).toBe(true)
  })

  test('explicit history-referencing phrasing warrants inspection regardless of intent or action', () => {
    const decision = assessCeoSelfInspection(fakeContext({ currentMessage: 'Did we already try raising prices before?' }), fakeContract())
    expect(decision.inspect).toBe(true)
    expect(decision.questions).toContain('What does my own execution/outcome history show for this?')
  })

  test('a plain explain/answer turn with no venture-history dependency does not warrant inspection', () => {
    const decision = assessCeoSelfInspection(fakeContext({ currentMessage: 'Can you explain how caching works?' }), fakeContract({ responseAction: 'explain' }))
    expect(decision.inspect).toBe(false)
  })
})

describe('gatherCeoSelfInspectionEvidence (pure, no DB access without identifiers)', () => {
  test('returns the honest empty-evidence shape when neither ventureId nor missionId is supplied', async () => {
    const evidence = await gatherCeoSelfInspectionEvidence({})
    expect(evidence.dataAvailable).toBe(false)
    expect(evidence.openRecommendations).toEqual([])
    expect(evidence.recentFailures).toEqual([])
    expect(evidence.openExecutions).toEqual([])
  })
})

describe('CEO evidence & supervision layer (real database)', () => {
  const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const missionId = `ci-evidence-mission-${runId}`
  const ventureId = `ci-evidence-venture-${runId}`
  const createdRecommendationIds: string[] = []

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for CEO evidence & supervision layer integration tests.')
  })

  async function cleanup() {
    if (!process.env.DATABASE_URL) return
    await db.executionReceipt.deleteMany({ where: { missionId } }).catch(() => {})
    for (const id of createdRecommendationIds) {
      await db.memory.deleteMany({ where: { key: `ceo_recommendation_${id}` } }).catch(() => {})
      await db.recommendationReview.deleteMany({ where: { recommendationId: id } }).catch(() => {})
    }
  }
  afterEach(cleanup)
  afterAll(cleanup)

  test('getExecutionReceipt/getExecutionReceiptsForMission return real, idempotent receipts', async () => {
    const idempotencyKey = `ci-key-${randomUUID()}`
    const { receipt, requestHash } = await startMandatoryExecution({ missionId, actorId: 'ci-actor', actorType: 'test', action: 'ci.write_receipt', idempotencyKey, args: { step: 1 } })
    const fetched = await getExecutionReceipt(missionId, idempotencyKey)
    expect(fetched).not.toBeNull()
    expect(fetched!.status).toBe('STARTED')
    await completeMandatoryExecution({ receiptId: receipt.id, missionId, status: 'SUCCESS', requestHash, output: { done: true } })
    const afterCompletion = await getExecutionReceipt(missionId, idempotencyKey)
    expect(afterCompletion!.status).toBe('SUCCESS')
    expect(afterCompletion!.completedAt).not.toBeNull()
    const all = await getExecutionReceiptsForMission(missionId)
    expect(all.some((r) => r.idempotencyKey === idempotencyKey)).toBe(true)
  })

  test('getOpenExecutions reports only STARTED, never-completed receipts -- never inferred from age', async () => {
    const openKey = `ci-open-${randomUUID()}`
    const closedKey = `ci-closed-${randomUUID()}`
    const openExec = await startMandatoryExecution({ missionId, actorId: 'ci-actor', actorType: 'test', action: 'ci.open', idempotencyKey: openKey, args: {} })
    const closedExec = await startMandatoryExecution({ missionId, actorId: 'ci-actor', actorType: 'test', action: 'ci.closed', idempotencyKey: closedKey, args: {} })
    await completeMandatoryExecution({ receiptId: closedExec.receipt.id, missionId, status: 'SUCCESS', requestHash: closedExec.requestHash })
    const open = await getOpenExecutions(missionId)
    const openKeys = open.map((r) => r.idempotencyKey)
    expect(openKeys).toContain(openKey)
    expect(openKeys).not.toContain(closedKey)
    void openExec
  })

  test('getExecutionFailures returns FAILED/DENIED receipts and never a SUCCESS one', async () => {
    const failKey = `ci-fail-${randomUUID()}`
    const okKey = `ci-ok-${randomUUID()}`
    const failExec = await startMandatoryExecution({ missionId, actorId: 'ci-actor', actorType: 'test', action: 'ci.fail', idempotencyKey: failKey, args: {} })
    const okExec = await startMandatoryExecution({ missionId, actorId: 'ci-actor', actorType: 'test', action: 'ci.ok', idempotencyKey: okKey, args: {} })
    await completeMandatoryExecution({ receiptId: failExec.receipt.id, missionId, status: 'FAILED', requestHash: failExec.requestHash, errorCode: 'CI_SIMULATED_FAILURE' })
    await completeMandatoryExecution({ receiptId: okExec.receipt.id, missionId, status: 'SUCCESS', requestHash: okExec.requestHash })
    const failures = await getExecutionFailures(missionId)
    const failureKeys = failures.map((r) => r.idempotencyKey)
    expect(failureKeys).toContain(failKey)
    expect(failureKeys).not.toContain(okKey)
  })

  test('getRecentExecutionOutcomes is scoped by actorId and only returns completed receipts', async () => {
    const actorId = `ci-actor-${randomUUID()}`
    const key = `ci-actor-scoped-${randomUUID()}`
    const exec = await startMandatoryExecution({ missionId, actorId, actorType: 'test', action: 'ci.actor_scoped', idempotencyKey: key, args: {} })
    const beforeCompletion = await getRecentExecutionOutcomes(actorId)
    expect(beforeCompletion.some((r) => r.idempotencyKey === key)).toBe(false)
    await completeMandatoryExecution({ receiptId: exec.receipt.id, missionId, status: 'SUCCESS', requestHash: exec.requestHash })
    const afterCompletion = await getRecentExecutionOutcomes(actorId)
    expect(afterCompletion.some((r) => r.idempotencyKey === key)).toBe(true)
  })

  test('gatherCeoSelfInspectionEvidence honestly aggregates real open recommendations and mission execution state', async () => {
    const rec = await recordCeoRecommendation({ correlationId: `ci-evidence-rec-${randomUUID()}`, objective: 'Self-inspection integration objective.', responseAction: 'decide', ventureId })
    createdRecommendationIds.push(rec.recommendationId)
    const failKey = `ci-evidence-fail-${randomUUID()}`
    const failExec = await startMandatoryExecution({ missionId, actorId: 'ci-actor', actorType: 'test', action: 'ci.evidence_fail', idempotencyKey: failKey, args: {} })
    await completeMandatoryExecution({ receiptId: failExec.receipt.id, missionId, status: 'FAILED', requestHash: failExec.requestHash, errorCode: 'CI_SIMULATED' })
    const evidence = await gatherCeoSelfInspectionEvidence({ ventureId, missionId })
    expect(evidence.dataAvailable).toBe(true)
    expect(evidence.openRecommendations.map((r) => r.recommendationId)).toContain(rec.recommendationId)
    expect(evidence.recentFailures.map((r) => r.idempotencyKey)).toContain(failKey)
  })

  test('recordRecommendationReview rejects an invalid verdict', async () => {
    const rec = await recordCeoRecommendation({ correlationId: `ci-review-invalid-${randomUUID()}`, objective: 'Review verdict validation.', responseAction: 'decide', ventureId })
    createdRecommendationIds.push(rec.recommendationId)
    await expect(recordRecommendationReview({ recommendationId: rec.recommendationId, reviewerId: 'owner-1', verdict: 'MAYBE' as never })).rejects.toThrow('Invalid recommendation review verdict')
  })

  test('a recommendation can be reviewed more than once -- append-only, never overwritten', async () => {
    const rec = await recordCeoRecommendation({ correlationId: `ci-review-append-${randomUUID()}`, objective: 'Append-only review history.', responseAction: 'decide', ventureId })
    createdRecommendationIds.push(rec.recommendationId)
    const first = await recordRecommendationReview({ recommendationId: rec.recommendationId, reviewerId: 'owner-1', verdict: 'REVIEWED', note: 'Looks reasonable.' })
    const second = await recordRecommendationReview({ recommendationId: rec.recommendationId, reviewerId: 'owner-1', verdict: 'APPROVED', note: 'Confirmed after outcome.' })
    expect(first.id).not.toBe(second.id)
    const reviews = await listRecommendationReviews(rec.recommendationId)
    expect(reviews.length).toBe(2)
    expect(reviews.map((r) => r.verdict)).toEqual(['REVIEWED', 'APPROVED'])
  })

  test('a legacy recommendation with no review stays honestly unreviewed', async () => {
    const reviews = await listRecommendationReviews('ci-nonexistent-recommendation-id')
    expect(reviews).toEqual([])
  })

  test('summarizeRecommendationLedger reports reviewedCount honestly, scoped by venture', async () => {
    const scopedVenture = `ci-review-summary-venture-${randomUUID()}`
    const recReviewed = await recordCeoRecommendation({ correlationId: `ci-review-summary-1-${randomUUID()}`, objective: 'Reviewed recommendation.', responseAction: 'decide', ventureId: scopedVenture })
    const recUnreviewed = await recordCeoRecommendation({ correlationId: `ci-review-summary-2-${randomUUID()}`, objective: 'Unreviewed recommendation.', responseAction: 'decide', ventureId: scopedVenture })
    createdRecommendationIds.push(recReviewed.recommendationId, recUnreviewed.recommendationId)
    await recordRecommendationReview({ recommendationId: recReviewed.recommendationId, reviewerId: 'owner-1', verdict: 'APPROVED' })
    const summary = await summarizeRecommendationLedger({ ventureId: scopedVenture })
    expect(summary.total).toBe(2)
    expect(summary.reviewedCount).toBe(1)
  })
})
