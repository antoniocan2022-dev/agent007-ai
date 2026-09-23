import { describe, expect, it } from 'bun:test'
import { preRouteCeoRequest } from '../src/lib/ceo-pre-router'
import { buildCanonicalConversationContext, buildCeoEvidenceObjective } from '@/lib/ceo-cognitive-conversation'
import { buildExternalEvidencePlan } from '@/lib/ceo-evidence-planner'
import { buildConversationDecisionContract } from '@/lib/ceo-conversation-decision-contract'
import { deriveCeoConversationState, resolveConversationReferences } from '@/lib/ceo-conversation-state'
import { isObjectiveAgreementContinuationRequest } from '@/lib/ceo-conversational-signals'

const INITIAL_RESEARCH = 'mmmm can you check all news and relevant information abour 2 stocks: a. GEOS and b. MIND Tecnologies'

function contextFor(currentMessage: string, threadTitle = INITIAL_RESEARCH, status: 'active' | 'paused' | 'resolved' = 'active') {
  return {
    schemaVersion: 1,
    currentMessage,
    meaning: currentMessage,
    semanticInterpretation: {
      schemaVersion: 1,
      meaning: currentMessage,
      confidence: 0.9,
      uncertainty: [],
      source: 'deterministic',
    },
    intentHint: 'conversation',
    speechAct: 'continuation',
    cognitiveDepth: 'contextual',
    referenceScope: 'cross_turn',
    references: [],
    worldModel: {
      schemaVersion: 1,
      workingTopic: 'stocks, geos, mind',
      subtopics: ['stocks', 'geos', 'mind'],
      userGoals: [],
      decisions: [],
      commitments: [],
      openLoops: [],
      activeThreads: status === 'active' || status === 'paused' ? [threadTitle] : [],
      importantEntities: ['GEOS', 'MIND'],
      recentCorrections: [],
      durableMemoryKeys: [],
    },
    state: {
      schemaVersion: 5,
      topic: 'stocks, geos, mind',
      topicCandidates: ['stocks', 'geos', 'mind'],
      entities: ['GEOS', 'MIND'],
      activeThreads: status === 'active' || status === 'paused' ? [threadTitle] : [],
      threads: [{
        id: 'conversation-thread-1',
        title: threadTitle,
        topic: 'stocks, geos, mind',
        entities: ['GEOS', 'MIND'],
        currentObjective: currentMessage,
        unresolvedQuestions: [],
        decisions: [],
        lastTouchedAt: Date.now(),
        status,
      }],
      unresolvedQuestions: [],
      decisions: [],
      decisionSignals: [],
      supersededDecisions: [],
      recentUserGoals: [],
      recentCorrections: [],
      tone: 'technical',
      turnCount: 4,
      lastUserMessage: currentMessage,
      lastAssistantMessage: '',
      updatedAt: Date.now(),
    },
  } as any
}

describe('CEO active objective continuity', () => {
  it('routes natural stock/news lookup wording into public-equity research', () => {
    const decision = preRouteCeoRequest([{ role: 'user', content: INITIAL_RESEARCH }])
    expect(decision.route).toBe('full')
    expect(decision.executionContract.intent).toBe('research')
    expect(decision.executionContract.domain).toBe('public_equity')
    expect(decision.executionContract.evidenceRequirement).toBe('multi_source')
    expect(decision.executionContract.executionRequirement).toBe('multi_source')
    expect(decision.executionContract.toolRequired).toBe(true)
  })

  it('propagates the same active research objective into canonical reference resolution and the single decision contract', () => {
    const followUp = 'Yes is exactly those. Go with a brief and plain-english of any press releases, earnings updates, analyst coverage, or other notable news from the past two weeks for each.'
    const priorRows = [
      { role: 'user' as const, content: INITIAL_RESEARCH, createdAt: 1 },
      { role: 'assistant' as const, content: 'Which MIND company do you mean?', createdAt: 2 },
    ]
    const state = deriveCeoConversationState(priorRows, followUp)
    const references = resolveConversationReferences(followUp, priorRows, state)
    expect(references).toHaveLength(1)
    expect(references[0]?.kind).toBe('continuation')
    expect(references[0]?.ambiguous).toBe(false)
    expect(references[0]?.resolvedText).toContain(INITIAL_RESEARCH.slice(0, 40))

    const canonical = buildCanonicalConversationContext({
      currentMessage: followUp,
      rows: priorRows,
      state,
      references,
      semanticInterpretation: {
        source: 'model_assisted',
        confidence: 0.95,
        suggestedIntent: 'conversation',
      },
    })
    const contract = buildConversationDecisionContract(canonical)
    const evidenceObjective = buildCeoEvidenceObjective(canonical)
    const evidencePlan = buildExternalEvidencePlan({
      objective: evidenceObjective,
      evidenceClass: 'external_web',
      domain: 'public_equity',
      operation: 'research',
      temporalScope: 'recent',
      evidenceProfile: 'public_equity',
    })
    expect(evidenceObjective).toContain('GEOS')
    expect(evidenceObjective).toContain('MIND')
    expect(evidenceObjective).toContain('press releases')
    expect(evidencePlan.queries.some((query) => query.ticker === 'GEOS')).toBe(true)
    expect(evidencePlan.queries.some((query) => query.ticker === 'MIND')).toBe(true)
    expect(canonical.speechAct).toBe('continuation')
    expect(canonical.intentHint).toBe('research')
    expect(contract.intent).toBe('research')
    expect(contract.toolRequirement).toBe('required')
    expect(contract.evidenceRequirement).toBe('required')
    expect(contract.responseAction).toBe('answer')
  })

  it('keeps the durable objective after a retrospective question and preserves the latest assistant reply for later continuation', () => {
    const priorRows = [
      { role: 'user' as const, content: INITIAL_RESEARCH, createdAt: 1 },
      { role: 'assistant' as const, content: 'Today we should verify the production SHA.', createdAt: 2 },
      { role: 'user' as const, content: 'What did we decide yesterday?', createdAt: 3 },
    ]
    const state = deriveCeoConversationState(priorRows, 'What did we decide yesterday?')
    expect(state.threads[0]?.currentObjective).toBe(INITIAL_RESEARCH)
    const continuation = resolveConversationReferences('Continue.', priorRows, state)[0]
    expect(continuation?.kind).toBe('continuation')
    expect(continuation?.resolvedText?.toLowerCase()).toContain('verify the production sha')
    expect(continuation?.resolvedText?.toLowerCase()).not.toContain('what did we decide yesterday')
  })

  it('does not inherit an active objective for a standalone reminder request', () => {
    const followUp = 'Remind me to call the accountant tomorrow.'
    const priorRows = [
      { role: 'user' as const, content: INITIAL_RESEARCH, createdAt: 1 },
      { role: 'assistant' as const, content: 'Ready.', createdAt: 2 },
    ]
    const state = deriveCeoConversationState(priorRows, followUp)
    expect(resolveConversationReferences(followUp, priorRows, state)).toEqual([])
  })

  it('does not inherit an active objective for a standalone generic summarization request', () => {
    const followUp = 'Summarize the report for me.'
    const priorRows = [
      { role: 'user' as const, content: INITIAL_RESEARCH, createdAt: 1 },
      { role: 'assistant' as const, content: 'Ready.', createdAt: 2 },
    ]
    const state = deriveCeoConversationState(priorRows, followUp)
    const references = resolveConversationReferences(followUp, priorRows, state)
    expect(references).toEqual([])
  })

  it('does inherit the active objective for a referential summarization request', () => {
    const followUp = 'Summarize this for me.'
    const priorRows = [
      { role: 'user' as const, content: INITIAL_RESEARCH, createdAt: 1 },
      { role: 'assistant' as const, content: 'Ready.', createdAt: 2 },
    ]
    const state = deriveCeoConversationState(priorRows, followUp)
    const references = resolveConversationReferences(followUp, priorRows, state)
    expect(references[0]?.kind).toBe('continuation')
    expect(references[0]?.ambiguous).toBe(false)
  })

  it('keeps canonical contract, pre-router, and evidence route aligned end-to-end under model-assisted disagreement', () => {
    const followUp = 'Yes is exactly those. Go with a brief and plain-english of any press releases, earnings updates, analyst coverage, or other notable news from the past two weeks for each.'
    const priorRows = [
      { role: 'user' as const, content: INITIAL_RESEARCH, createdAt: 1 },
      { role: 'assistant' as const, content: 'Which MIND company do you mean?', createdAt: 2 },
    ]
    const state = deriveCeoConversationState(priorRows, followUp)
    const references = resolveConversationReferences(followUp, priorRows, state)
    const canonical = buildCanonicalConversationContext({
      currentMessage: followUp,
      rows: priorRows,
      state,
      references,
      semanticInterpretation: { source: 'model_assisted', confidence: 0.95, suggestedIntent: 'conversation' },
    })
    const decisionContract = buildConversationDecisionContract(canonical)
    const preRoute = preRouteCeoRequest(
      [{ role: 'user', content: INITIAL_RESEARCH }, { role: 'assistant', content: 'Which MIND company do you mean?' }, { role: 'user', content: followUp }],
      0,
      canonical,
      decisionContract,
    )
    expect(decisionContract.intent).toBe('research')
    expect(decisionContract.evidenceRequirement).toBe('required')
    expect(preRoute.executionContract.intent).toBe(decisionContract.intent)
    expect(preRoute.executionContract.evidenceClass).toBe('external_web')
    expect(preRoute.executionContract.evidenceRequirement).toBe('multi_source')
    expect(preRoute.executionContract.executionRequirement).toBe('multi_source')
    expect(preRoute.executionContract.toolRequired).toBe(true)
    expect(preRoute.route).toBe('full')
  })

  it('does not classify an agreement-led unrelated task as an objective continuation', () => {
    expect(isObjectiveAgreementContinuationRequest('Yes, go ahead. Tell me about the weather in Montreal.')).toBe(false)
    expect(isObjectiveAgreementContinuationRequest("That's right. Proceed with the unrelated budget report.")).toBe(false)
  })

  it('inherits the active research objective through an agreement-led task refinement from the live failure shape', () => {
    const followUp = 'Yes is exactly those. Go with a brief and plain-english of any press releases, earnings updates, analyst coverage, or other notable news from the past two weeks for each.'
    const decision = preRouteCeoRequest(
      [{ role: 'user', content: INITIAL_RESEARCH }, { role: 'assistant', content: 'Which MIND company do you mean?' }, { role: 'user', content: followUp }],
      0,
      contextFor(followUp),
    )
    expect(decision.route).toBe('full')
    expect(decision.executionContract.intent).toBe('research')
    expect(decision.executionContract.domain).toBe('public_equity')
    expect(decision.executionContract.evidenceClass).toBe('external_web')
    expect(decision.executionContract.evidenceRequirement).toBe('multi_source')
    expect(decision.executionContract.executionRequirement).toBe('multi_source')
    expect(decision.executionContract.toolRequired).toBe(true)
  })

  it('does not inherit a public-equity objective for an agreement-led but unrelated new task', () => {
    const followUp = 'Yes, exactly. Tell me about the weather in Montreal.'
    const decision = preRouteCeoRequest(
      [{ role: 'user', content: INITIAL_RESEARCH }, { role: 'assistant', content: 'Ready.' }, { role: 'user', content: followUp }],
      0,
      contextFor(followUp),
    )
    expect(decision.executionContract.domain).not.toBe('public_equity')
    expect(decision.executionContract.evidenceRequirement).not.toBe('multi_source')
  })

  it('keeps the inherited research route authoritative even when the semantic assistant suggests conversation', () => {
    const followUp = 'Yes is exactly those. Go with a brief and plain-english of any press releases, earnings updates, analyst coverage, or other notable news from the past two weeks for each.'
    const context = contextFor(followUp)
    context.semanticInterpretation = {
      ...context.semanticInterpretation,
      source: 'model_assisted',
      confidence: 0.95,
      suggestedIntent: 'conversation',
    }
    context.intentHint = 'conversation'
    const decision = preRouteCeoRequest(
      [{ role: 'user', content: INITIAL_RESEARCH }, { role: 'assistant', content: 'Which MIND company do you mean?' }, { role: 'user', content: followUp }],
      0,
      context,
    )
    expect(decision.executionContract.intent).toBe('research')
    expect(decision.executionContract.evidenceClass).toBe('external_web')
    expect(decision.executionContract.toolRequired).toBe(true)
  })

  it('inherits the active research objective through a bare confirmation', () => {
    const decision = preRouteCeoRequest(
      [{ role: 'user', content: INITIAL_RESEARCH }, { role: 'assistant', content: 'Ready to proceed.' }, { role: 'user', content: 'yes, go ahead' }],
      0,
      contextFor('yes, go ahead'),
    )
    expect(decision.route).toBe('full')
    expect(decision.executionContract.intent).toBe('research')
    expect(decision.executionContract.domain).toBe('public_equity')
    expect(decision.executionContract.evidenceRequirement).toBe('multi_source')
    expect(decision.executionContract.executionRequirement).toBe('multi_source')
    expect(decision.executionContract.toolRequired).toBe(true)
  })

  it('preserves the objective through an entity correction plus continue', () => {
    const correction = 'Im talking about NasdaqCM - MIND Technology, Inc. (MIND), continue'
    const decision = preRouteCeoRequest(
      [{ role: 'user', content: INITIAL_RESEARCH }, { role: 'assistant', content: 'Which MIND company do you mean?' }, { role: 'user', content: correction }],
      0,
      contextFor(correction),
    )
    expect(decision.route).toBe('full')
    expect(decision.executionContract.intent).toBe('research')
    expect(decision.executionContract.domain).toBe('public_equity')
    expect(decision.executionContract.evidenceRequirement).toBe('multi_source')
    expect(decision.executionContract.executionRequirement).toBe('multi_source')
    expect(decision.executionContract.toolRequired).toBe(true)
  })

  it('accepts paused threads as continuable but rejects resolved threads', () => {
    const paused = preRouteCeoRequest(
      [{ role: 'user', content: 'continue' }],
      0,
      contextFor('continue', INITIAL_RESEARCH, 'paused'),
    )
    expect(paused.executionContract.intent).toBe('research')
    expect(paused.executionContract.domain).toBe('public_equity')

    const resolved = preRouteCeoRequest(
      [{ role: 'user', content: 'continue' }],
      0,
      contextFor('continue', INITIAL_RESEARCH, 'resolved'),
    )
    expect(resolved.executionContract.intent).toBe('conversation')
    expect(resolved.route).toBe('fast')
  })

  it('does not turn a normal internal check into public-equity research', () => {
    const decision = preRouteCeoRequest([{ role: 'user', content: 'check our stockroom inventory for missing parts' }])
    expect(decision.executionContract.intent).not.toBe('research')
    expect(decision.executionContract.domain).not.toBe('public_equity')
  })
})
