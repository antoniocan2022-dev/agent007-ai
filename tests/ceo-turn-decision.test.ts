import { describe, expect, test } from 'bun:test'
import { buildCeoTurnDecision } from '@/lib/ceo-turn-decision'
import { buildCeoDecisionPlan } from '@/lib/ceo-cognitive-kernel'
import { preRouteCeoRequest } from '@/lib/ceo-pre-router'
import { buildCanonicalConversationContext } from '@/lib/ceo-cognitive-conversation'
import { deriveCeoConversationState } from '@/lib/ceo-conversation-state'
import { buildConversationDecisionContract } from '@/lib/ceo-conversation-decision-contract'

const user = (content: string) => [{ role: 'user' as const, content }]

// Phase 2 of the CEO Conversation Kernel migration (external audit, 2026-09-19), issues 1 and 8:
// CeoTurnDecision is the single "DECIDE" authority for a turn -- a thin envelope built exactly once,
// combining the turn's DecisionPlan (execution/orchestration policy) and, when available, its
// ConversationDecisionContract (conversational/semantic decision). It does not replace either
// underlying type -- see ceo-turn-decision.ts's own header comment for why Stage 2 correctly kept them
// separate -- it is the one object route.ts now builds once and threads through every consumer instead
// of letting each one build its own copy.
describe('buildCeoTurnDecision', () => {
  test('produces a decisionPlan structurally identical to a direct buildCeoDecisionPlan call for the same inputs', () => {
    const message = 'Tell me about NVDA stock.'
    const preRoute = preRouteCeoRequest(user(message))
    const turnDecision = buildCeoTurnDecision({ messages: user(message), preRoute })
    const directPlan = buildCeoDecisionPlan({ messages: user(message), preRoute })
    expect(turnDecision.decisionPlan.path).toBe(directPlan.path)
    expect(turnDecision.decisionPlan.executionContract).toEqual(directPlan.executionContract)
    expect(turnDecision.decisionPlan.taskClass).toBe(directPlan.taskClass)
  })

  test('carries intent, orchestrationOwner, and path straight from the decisionPlan', () => {
    const message = 'Fix the Vercel deployment problem.'
    const preRoute = preRouteCeoRequest(user(message))
    const turnDecision = buildCeoTurnDecision({ messages: user(message), preRoute })
    expect(turnDecision.intent).toBe('tool_action')
    expect(turnDecision.orchestrationOwner).toBe('operational_orchestrator')
    expect(turnDecision.path).toBe(turnDecision.decisionPlan.path)
    expect(turnDecision.requestId).toBe(turnDecision.decisionPlan.requestId)
  })

  test('carries the supplied decisionContract through verbatim, including its responseAction', () => {
    const message = 'What should we do about our pricing strategy this quarter?'
    const preRoute = preRouteCeoRequest(user(message))
    const state = deriveCeoConversationState([], message)
    const context = buildCanonicalConversationContext({ currentMessage: message, rows: [], state, references: [] })
    const decisionContract = buildConversationDecisionContract(context)
    const turnDecision = buildCeoTurnDecision({ messages: user(message), preRoute, decisionContract })
    expect(turnDecision.decisionContract).toBe(decisionContract)
    expect(turnDecision.responseAction).toBe(decisionContract.responseAction)
  })

  test('leaves decisionContract and responseAction undefined when no contract is supplied, rather than fabricating one', () => {
    const message = 'Hi!'
    const preRoute = preRouteCeoRequest(user(message))
    const turnDecision = buildCeoTurnDecision({ messages: user(message), preRoute })
    expect(turnDecision.decisionContract).toBeUndefined()
    expect(turnDecision.responseAction).toBeUndefined()
  })
})
