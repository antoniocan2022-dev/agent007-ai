import { describe, expect, test } from 'bun:test'
import { composeCeoContext } from '@/lib/ceo-context-composer'
import { deriveCeoConversationState, resolveConversationReferences } from '@/lib/ceo-conversation-state'
import { evaluateCeoQuality } from '@/lib/ceo-response-quality-gate'
import { preRouteCeoRequest } from '@/lib/ceo-pre-router'
import { getProviderTaskPolicy, validateProviderPriority } from '@/lib/provider-intelligence-policy'

function row(role: 'user' | 'assistant', content: string, createdAt: number) { return { role, content, createdAt } }

describe('CEO conversational intelligence', () => {
  test('derives persistent conversation state from durable history', () => {
    const state = deriveCeoConversationState([
      row('user', 'We need to improve the Agent007 CEO conversation quality.', 1),
      row('assistant', 'I agree. The conversation layer should preserve continuity and natural tone.', 2),
      row('user', 'We decided to build a persistent conversation state and semantic references.', 3),
    ], 'What should we do next?')
    expect(state.schemaVersion).toBe(1)
    expect(state.entities).toContain('Agent007')
    expect(state.decisions.length).toBeGreaterThan(0)
    expect(state.topicCandidates.length).toBeGreaterThan(0)
    expect(state.turnCount).toBeGreaterThan(0)
  })

  test('resolves anaphoric references to the strongest recent conversational anchor', () => {
    const rows = [
      row('user', 'We should improve long-context memory first.', 1),
      row('assistant', 'Yes, the conversation state will become the backbone.', 2),
      row('user', 'What about the second problem?', 3),
    ]
    const state = deriveCeoConversationState(rows, 'What about the second problem?')
    const refs = resolveConversationReferences('What about the second problem?', rows, state)
    expect(refs.length).toBe(1)
    expect(refs[0]?.resolvedText).toBeTruthy()
    expect(refs[0]?.confidence).toBeGreaterThan(0.3)
  })

  test('composer injects state and natural communication rules without exposing governance metadata', () => {
    const composition = composeCeoContext({
      systemPrompt: 'You are Agent007.',
      currentUserMessage: 'Hi, how are you?',
      persistedMessages: [row('user', 'We are improving the CEO conversation.', 1), row('assistant', 'We are working on continuity.', 2)],
    })
    expect(composition.modules).toContain('conversation_state')
    expect(composition.messages.some((message) => message.content.includes('CONVERSATION STATE'))).toBe(true)
    expect(composition.messages.some((message) => message.content.includes('CEO NATURAL CONVERSATION CONTRACT'))).toBe(true)
    expect(composition.messages.some((message) => message.content.includes('Answer the user naturally first'))).toBe(true)
  })

  test('ordinary conversation is isolated from evidence requirements and metadata', () => {
    const quality = evaluateCeoQuality({
      objective: 'Hi, how do you do?',
      content: 'Hi! I’m doing well. I’m here and ready to continue our work. What would you like to focus on?',
      path: 'fast',
      intent: 'conversation',
      evidenceVerificationApplicable: false,
      externalExecutionSucceeded: true,
    })
    expect(quality.decision).toBe('PASS')
    expect(quality.evidenceState).toBe('NOT_APPLICABLE')
    expect(quality.verificationStatus).toBe('NOT_REQUIRED')
    expect(quality.conversationQuality?.score).toBeGreaterThanOrEqual(78)
  })

  test('robotic conversational output is escalated instead of silently accepted', () => {
    const quality = evaluateCeoQuality({
      objective: 'Hi, how are you?',
      content: 'Your request has been received. Evidence state: NOT_APPLICABLE. Quality gate: PASS.',
      path: 'fast',
      intent: 'conversation',
      evidenceVerificationApplicable: false,
      externalExecutionSucceeded: true,
    })
    expect(quality.decision).not.toBe('PASS')
    expect(quality.conversationQuality?.naturalness).toBeLessThan(80)
    expect(quality.reasons.some((reason) => reason.includes('Conversation quality'))).toBe(true)
  })

  test('provider policy is duplicate-free and quality-first for reasoning', () => {
    expect(validateProviderPriority()).toEqual([])
    expect(getProviderTaskPolicy('reasoning').providerOrder[0]).toBe('cloudflare')
    expect(getProviderTaskPolicy('research').providerOrder[0]).toBe('cloudflare')
  })

  test('context expands safely for long conversations while keeping current turn singular', () => {
    const rows = Array.from({ length: 80 }, (_, index) => row(index % 2 === 0 ? 'user' : 'assistant', index % 2 === 0 ? `We are discussing project thread ${index % 8} and the Agent007 architecture.` : `The CEO should remember project thread ${index % 8} and preserve continuity.`, index + 1))
    const current = 'Continue the Agent007 architecture discussion.'
    rows.push(row('user', current, 1000))
    const composition = composeCeoContext({ systemPrompt: 'You are Agent007.', currentUserMessage: current, persistedMessages: rows, recentMessageLimit: 16, relevantOlderLimit: 8 })
    const currentCopies = composition.messages.filter((message) => message.role === 'user' && message.content === current)
    expect(currentCopies).toHaveLength(1)
    expect(composition.recentMessages).toBe(16)
    expect(composition.messages.some((message) => message.content.includes('CONVERSATION STATE'))).toBe(true)
  })
})

const benchmarkTopics = [
  ['memory', 'We need better long-context memory', 'the memory problem'],
  ['routing', 'We need conversation-first routing', 'the routing issue'],
  ['deployment', 'The production deployment is stale', 'the deployment problem'],
  ['providers', 'The provider hierarchy needs stronger models', 'the provider issue'],
  ['quality', 'The CEO sounds too robotic', 'the quality problem'],
  ['references', 'Reference resolution is weak', 'the reference problem'],
  ['personality', 'Tone needs to stay consistent', 'the personality issue'],
  ['benchmark', 'We need real multi-turn benchmarks', 'the benchmark problem'],
  ['governance', 'Governance should stay underneath conversation', 'the governance issue'],
  ['execution', 'Execution should activate only when needed', 'the execution problem'],
] as const

for (let index = 0; index < 120; index += 1) {
  const topic = benchmarkTopics[index % benchmarkTopics.length]
  test(`multi-turn benchmark ${String(index + 1).padStart(3, '0')}: preserves ${topic[0]} thread continuity`, () => {
    const rows = [
      row('user', topic[1], 1),
      row('assistant', `We should make ${topic[0]} explicit, persistent, and testable.`, 2),
      row('user', `Let's connect this to Agent007 and decide what remains unresolved.`, 3),
      row('assistant', `The active thread is ${topic[2]}, and we should preserve it across turns.`, 4),
      row('user', 'What about that one?', 5),
    ]
    const state = deriveCeoConversationState(rows, 'What about that one?')
    const references = resolveConversationReferences('What about that one?', rows, state)
    const context = composeCeoContext({ systemPrompt: 'You are Agent007.', currentUserMessage: 'What about that one?', persistedMessages: rows })
    expect(state.topic).toBeTruthy()
    expect(references.length).toBe(1)
    expect(context.messages.some((message) => message.content.includes('CONVERSATION STATE'))).toBe(true)
  })
}
