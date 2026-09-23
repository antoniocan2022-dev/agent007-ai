import { describe, expect, it } from 'bun:test'
import { preRouteCeoRequest } from '../src/lib/ceo-pre-router'
import { deriveCeoConversationState, resolveConversationReferences } from '../src/lib/ceo-conversation-state'
import { buildCanonicalConversationContext, buildCeoEvidenceObjective } from '../src/lib/ceo-cognitive-conversation'
import { buildConversationDecisionContract } from '@/lib/ceo-conversation-decision-contract'
import { buildExternalEvidencePlan } from '@/lib/ceo-evidence-planner'
import { isObjectiveContinuationSignal } from '@/lib/ceo-conversational-signals'
import { isObjectiveProgressionRequest, isObjectiveContinuationSignal } from '../src/lib/ceo-conversational-signals'

const now = Date.now()

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

  it('preserves pronoun-led objective continuations through the real state/context/pre-router chain', () => {
    for (const followUp of [
      'That principle should guide the next upgrade.',
      'That is more important than minimizing latency.',
    ]) {
      const rows = [
        { role: 'user' as const, content: INITIAL_RESEARCH, createdAt: now },
        { role: 'assistant' as const, content: 'The research should focus on the current facts.', createdAt: now + 1 },
      ]
      const state = deriveCeoConversationState(rows, followUp)
      const context = buildCanonicalConversationContext({ currentMessage: followUp, rows, state, references: [] })
      const decision = preRouteCeoRequest(
        [...rows, { role: 'user' as const, content: followUp }],
        0,
        context,
      )
      expect(state.threads).toHaveLength(1)
      expect(context.speechAct).toBe('continuation')
      expect(decision.executionContract.intent).toBe('research')
      expect(decision.executionContract.domain).toBe('public_equity')
      expect(decision.executionContract.evidenceClass).toBe('external_web')
    }
  })

  it('verifies the live-shaped follow-up through the real conversation-state and canonical-context builders', () => {
    const followUp = 'Yes is exactly those. Go with a brief and plain-english of any press releases, earnings updates, analyst coverage, or other notable news from the past two weeks for each.'
    const rows = [
      { role: 'user' as const, content: INITIAL_RESEARCH, createdAt: now },
      { role: 'assistant' as const, content: 'Which MIND company do you mean?', createdAt: now + 1 },
    ]
    const state = deriveCeoConversationState(rows, followUp)
    const context = buildCanonicalConversationContext({ currentMessage: followUp, rows, state, references: [] })
    const decision = preRouteCeoRequest(
      [...rows, { role: 'user' as const, content: followUp }],
      0,
      context,
    )
    expect(state.threads).toHaveLength(1)
    expect(state.threads[0]?.title).toContain('GEOS')
    expect(context.speechAct).toBe('continuation')
    expect(decision.executionContract.intent).toBe('research')
    expect(decision.executionContract.domain).toBe('public_equity')
    expect(decision.executionContract.evidenceClass).toBe('external_web')
    expect(decision.executionContract.evidenceRequirement).toBe('multi_source')
  })

  it('propagates the live research follow-up through canonical references and the single decision contract', () => {
    const followUp = 'Yes is exactly those. Go with a brief and plain-english of any press releases, earnings updates, analyst coverage, or other notable news from the past two weeks for each.'
    const rows = [
      { role: 'user' as const, content: INITIAL_RESEARCH, createdAt: now },
      { role: 'assistant' as const, content: 'Which MIND company do you mean?', createdAt: now + 1 },
    ]
    const state = deriveCeoConversationState(rows, followUp)
    const references = resolveConversationReferences(followUp, rows, state)
    expect(isObjectiveContinuationSignal(followUp)).toBe(true)
    expect(references[0]?.kind).toBe('continuation')
    expect(references[0]?.ambiguous).toBe(false)
    expect(references[0]?.resolvedObjective).toBe(INITIAL_RESEARCH)

    const context = buildCanonicalConversationContext({
      currentMessage: followUp,
      rows,
      state,
      references,
      semanticInterpretation: { source: 'model_assisted', confidence: 0.95, suggestedIntent: 'conversation' },
    })
    const contract = buildConversationDecisionContract(context)
    expect(context.speechAct).toBe('continuation')
    expect(context.intentHint).toBe('research')
    expect(contract.intent).toBe('research')
    expect(contract.responseAction).toBe('answer')
    expect(contract.toolRequirement).toBe('required')
    expect(contract.evidenceRequirement).toBe('required')

    const evidenceObjective = buildCeoEvidenceObjective(context)
    expect(evidenceObjective).toContain('GEOS')
    expect(evidenceObjective).toContain('MIND')
    expect(evidenceObjective).toContain('press releases')
    const plan = buildExternalEvidencePlan({
      objective: evidenceObjective,
      evidenceClass: 'external_web',
      domain: 'public_equity',
      operation: 'research',
      temporalScope: 'recent',
      evidenceProfile: 'public_equity',
    })
    expect(plan.queries.some((query) => query.ticker === 'GEOS')).toBe(true)
    expect(plan.queries.some((query) => query.ticker === 'MIND')).toBe(true)
  })

  it('keeps ordinary Continue conversational even when the assistant reply contains decision vocabulary', () => {
    const followUp = 'Continue.'
    const rows = [
      { role: 'user' as const, content: 'We are building Agent007 into a strong executive partner.', createdAt: now },
      { role: 'assistant' as const, content: 'The next priority is stronger conversation quality.', createdAt: now + 1 },
    ]
    const state = deriveCeoConversationState(rows, followUp)
    const references = resolveConversationReferences(followUp, rows, state)
    const context = buildCanonicalConversationContext({ currentMessage: followUp, rows, state, references })
    const contract = buildConversationDecisionContract(context)
    expect(references[0]?.resolvedText).toContain('next priority')
    expect(references[0]?.resolvedObjective).toContain('strong executive partner')
    expect(context.intentHint).toBe('conversation')
    expect(contract.intent).toBe('conversation')
    expect(contract.responseRegister).toBe('conversational')
  })

  it('does not let a retrospective question replace the durable active objective', () => {
    const rows = [
      { role: 'user' as const, content: INITIAL_RESEARCH, createdAt: now },
      { role: 'assistant' as const, content: 'Today we should verify the production SHA.', createdAt: now + 1 },
      { role: 'user' as const, content: 'What did we decide yesterday?', createdAt: now + 2 },
    ]
    const state = deriveCeoConversationState(rows, 'What did we decide yesterday?')
    expect(state.threads).toHaveLength(1)
    expect(state.threads[0]?.currentObjective).toBe(INITIAL_RESEARCH)
  })

  it('does not treat generic summarization or reminder requests as active-objective continuation', () => {
    expect(isObjectiveContinuationSignal('Summarize the report for me.')).toBe(false)
    expect(isObjectiveContinuationSignal('Remind me to call the accountant tomorrow.')).toBe(false)
    expect(isObjectiveContinuationSignal('Summarize this for me.')).toBe(true)
    expect(isObjectiveContinuationSignal('Remind me what we decided.')).toBe(true)
  })

  it('does not let a retrospective question replace the durable objective or poison the next continuation', () => {
    const rows = [
      { role: 'user' as const, content: INITIAL_RESEARCH, createdAt: now },
      { role: 'assistant' as const, content: 'We should verify the production SHA.', createdAt: now + 1 },
      { role: 'user' as const, content: 'What did we decide yesterday?', createdAt: now + 2 },
    ]
    const state = deriveCeoConversationState(rows, rows[2].content)
    expect(state.threads).toHaveLength(1)
    expect(state.threads[0]?.currentObjective).toBe(INITIAL_RESEARCH)
    const references = resolveConversationReferences('Continue.', rows, state)
    expect(references[0]?.kind).toBe('continuation')
    expect(references[0]?.resolvedObjective).toBe(INITIAL_RESEARCH)
    expect(references[0]?.resolvedText).toContain('verify the production SHA')
  })

  it('retains a concise but substantive research objective instead of dropping it by character count', () => {
    const shortObjective = 'Research GEOS'
    const rows = [
      { role: 'user' as const, content: shortObjective, createdAt: now },
      { role: 'assistant' as const, content: 'Ready to research it.', createdAt: now + 1 },
    ]
    const state = deriveCeoConversationState(rows, 'continue')
    expect(state.threads).toHaveLength(1)
    expect(state.threads[0]?.title).toBe(shortObjective)
    const context = buildCanonicalConversationContext({ currentMessage: 'continue', rows, state, references: [] })
    const decision = preRouteCeoRequest(
      [...rows, { role: 'user' as const, content: 'continue' }],
      0,
      context,
    )
    expect(decision.executionContract.intent).toBe('research')
    expect(decision.executionContract.domain).toBe('public_equity')
    expect(decision.executionContract.evidenceClass).toBe('external_web')
  })

  it('routes a bare confirmation through the real state/context/pre-router chain', () => {
    const followUp = 'yes, go ahead'
    const rows = [
      { role: 'user' as const, content: INITIAL_RESEARCH, createdAt: now },
      { role: 'assistant' as const, content: 'Ready to proceed.', createdAt: now + 1 },
    ]
    const state = deriveCeoConversationState(rows, followUp)
    const context = buildCanonicalConversationContext({ currentMessage: followUp, rows, state, references: [] })
    const decision = preRouteCeoRequest(
      [...rows, { role: 'user' as const, content: followUp }],
      0,
      context,
    )
    expect(state.threads).toHaveLength(1)
    expect(decision.executionContract.intent).toBe('research')
    expect(decision.executionContract.domain).toBe('public_equity')
    expect(decision.executionContract.evidenceClass).toBe('external_web')
  })

  it('keeps a bare confirmation attached to the existing research thread', () => {
    const rows = [
      { role: 'user' as const, content: INITIAL_RESEARCH, createdAt: now },
      { role: 'assistant' as const, content: 'Ready to proceed.', createdAt: now + 1 },
      { role: 'user' as const, content: 'yes, go ahead', createdAt: now + 2 },
    ]
    const state = deriveCeoConversationState(rows, 'yes, go ahead')
    expect(state.threads).toHaveLength(1)
    expect(state.threads[0]?.title).toContain('GEOS')
    expect(state.threads[0]?.status).toBe('active')
  })

  it('does not merge a low-confidence pronoun reference into the active research thread', () => {
    const rows = [
      { role: 'user' as const, content: INITIAL_RESEARCH, createdAt: now },
      { role: 'assistant' as const, content: 'Ready.', createdAt: now + 1 },
      { role: 'user' as const, content: 'This morning I had a meeting about the weather in Montreal.', createdAt: now + 2 },
    ]
    const state = deriveCeoConversationState(rows, rows[2].content)
    expect(state.threads).toHaveLength(2)
    expect(state.threads[0]?.status).toBe('superseded')
    expect(state.threads[1]?.status).toBe('active')
    expect(state.threads[1]?.title).toContain('This morning')
  })

  it('does not keep an unrelated sentence that merely ends in yes inside the active research thread', () => {
    const rows = [
      { role: 'user' as const, content: INITIAL_RESEARCH, createdAt: now },
      { role: 'assistant' as const, content: 'Ready.', createdAt: now + 1 },
      { role: 'user' as const, content: 'I think we should discuss the weather in Montreal, yes.', createdAt: now + 2 },
    ]
    const state = deriveCeoConversationState(rows, rows[2].content)
    expect(state.threads).toHaveLength(2)
    expect(state.threads[0]?.status).toBe('superseded')
    expect(state.threads[1]?.status).toBe('active')
    expect(state.threads[1]?.title).toContain('weather in Montreal')
  })

  it('preserves a sequenced objective statement such as a second priority', () => {
    const rows = [
      { role: 'user' as const, content: 'We want Agent007 to generate real business outcomes.', createdAt: now },
      { role: 'assistant' as const, content: 'The first priority is repeatable customer value.', createdAt: now + 1 },
      { role: 'user' as const, content: 'The second priority is measurement.', createdAt: now + 2 },
      { role: 'assistant' as const, content: 'That gives us a business loop rather than a demo.', createdAt: now + 3 },
    ]
    const state = deriveCeoConversationState(rows, rows[2].content)
    expect(isObjectiveProgressionRequest(rows[2].content)).toBe(true)
    expect(state.threads).toHaveLength(1)
    expect(state.threads[0]?.title).toContain('Agent007')
    const resolution = state.threads[0]?.lastAssistantReply
    expect(resolution).toContain('business loop')
  })

  it('splits an unrelated topic instead of poisoning the prior active objective', () => {
    const rows = [
      { role: 'user' as const, content: INITIAL_RESEARCH, createdAt: now },
      { role: 'assistant' as const, content: 'Ready.', createdAt: now + 1 },
      { role: 'user' as const, content: 'Tell me about the weather in Montreal tomorrow.', createdAt: now + 2 },
    ]
    const state = deriveCeoConversationState(rows, rows[2].content)
    expect(state.threads).toHaveLength(2)
    expect(state.threads[0]?.status).toBe('superseded')
    expect(state.threads[1]?.status).toBe('active')
    expect(state.threads[1]?.title).toContain('weather in Montreal')
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
