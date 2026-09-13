import { describe, expect, test } from 'bun:test'
import { buildCanonicalConversationContext } from '@/lib/ceo-cognitive-conversation'
import { deriveCeoConversationState } from '@/lib/ceo-conversation-state'
import { buildConversationDecisionContract } from '@/lib/ceo-conversation-decision-contract'

const contextFor = (message: string) => {
  const state = deriveCeoConversationState([], message)
  return buildCanonicalConversationContext({ currentMessage: message, rows: [], state, references: [] })
}

// Deep-audit fix (2026-09-13): evidenceRequirementFor only reached 'possible' for responseAction
// 'decide' when context.intentHint also happened to be 'analysis'/'decision' -- a drift case (intent
// hint disagreeing with the resolved action) silently fell through to 'none', identical to a pure
// clarify/self-assessment turn, contradicting the stated priority that decisions need more grounding
// than casual conversation. 'decide' now reaches 'possible' explicitly, matching 'recommend'.
describe('conversation decision contract: "decide" never silently drops to no evidence requirement', () => {
  test.each([
    'We need to decide between vendor A and vendor B.',
    'Pick vendor A or vendor B for the contract.',
    'Choose between expanding to Europe or Asia first.',
  ])('a "decide" response action gets evidenceRequirement "possible", not "none": %s', (message) => {
    const contract = buildConversationDecisionContract(contextFor(message))
    expect(contract.responseAction).toBe('decide')
    expect(contract.evidenceRequirement).toBe('possible')
  })
})
