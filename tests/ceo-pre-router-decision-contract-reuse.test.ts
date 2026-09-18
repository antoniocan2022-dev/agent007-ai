import { describe, expect, test } from 'bun:test'
import { preRouteCeoRequest } from '@/lib/ceo-pre-router'
import { buildCanonicalConversationContext } from '@/lib/ceo-cognitive-conversation'
import { buildConversationDecisionContract, type ConversationDecisionContract } from '@/lib/ceo-conversation-decision-contract'
import { deriveCeoConversationState } from '@/lib/ceo-conversation-state'

const user = (content: string) => [{ role: 'user' as const, content }]
const contextFor = (message: string) => {
  const state = deriveCeoConversationState([], message)
  return buildCanonicalConversationContext({ currentMessage: message, rows: [], state, references: [], memories: [] })
}

// Stage 2 of the CEO Conversation Kernel migration (2026-09-18): preRouteCeoRequest used to always
// rebuild its own ConversationDecisionContract internally from semanticContext -- a second, byte-
// identical copy of the one route.ts's composeCeoContext had already built a moment earlier for the
// exact same context, used here only for curiosity/evidence narrowing and then discarded. The optional
// 4th parameter lets a caller pass the already-built contract through instead. These tests certify two
// things a "just accept and ignore the parameter" implementation would NOT satisfy: (1) supplying the
// naturally-equivalent contract is fully behaviorally transparent, and (2) supplying a contract whose
// content genuinely differs from what would be internally rebuilt actually changes the routing outcome
// -- proving the parameter is real input, not a no-op.
describe('pre-router: decisionContract parameter is consumed, not just accepted', () => {
  // "describe how the deployment pipeline works" deterministically classifies as plain 'conversation'
  // (no tool/production/mission/research keyword, no contextual-reference pronoun that would divert it
  // into the ambiguous-context branch, which builds its own fresh executionContract and would mask
  // this test) -- landing it in the one branch (ceo-pre-router.ts's governedByDeterministicIntent guard)
  // that narrows executionContract.toolRequired directly off canonicalDecision.toolRequirement.
  const message = 'Please describe how the deployment pipeline works.'

  test('passing the naturally-equivalent decisionContract is byte-identical to letting pre-router rebuild its own', () => {
    const context = contextFor(message)
    const naturalContract = buildConversationDecisionContract(context)
    const rebuilt = preRouteCeoRequest(user(message), 0, context)
    const passedThrough = preRouteCeoRequest(user(message), 0, context, naturalContract)
    expect(JSON.stringify(passedThrough)).toBe(JSON.stringify(rebuilt))
  })

  test('a decisionContract whose toolRequirement genuinely differs from the natural one changes toolRequired -- proving the parameter is actually read', () => {
    const context = contextFor(message)
    const naturalContract = buildConversationDecisionContract(context)
    expect(naturalContract.toolRequirement).toBe('none')
    const withoutInjection = preRouteCeoRequest(user(message), 0, context)
    expect(withoutInjection.executionContract.toolRequired).toBe(false)
    const mutated: ConversationDecisionContract = { ...naturalContract, toolRequirement: 'required' }
    const withInjection = preRouteCeoRequest(user(message), 0, context, mutated)
    expect(withInjection.executionContract.toolRequired).toBe(true)
  })

  test('omitting decisionContract with a semanticContext present still works exactly as before (backward compatible)', () => {
    const context = contextFor(message)
    const decision = preRouteCeoRequest(user(message), 0, context)
    expect(decision.executionContract.intent).toBe('conversation')
  })
})
