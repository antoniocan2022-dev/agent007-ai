import { describe, expect, it } from 'bun:test'
import { preRouteCeoRequest } from '../src/lib/ceo-pre-router'

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
})
