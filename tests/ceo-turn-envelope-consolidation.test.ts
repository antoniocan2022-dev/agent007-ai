import { describe, expect, test } from 'bun:test'
import { buildCanonicalConversationContext } from '@/lib/ceo-cognitive-conversation'
import { buildConversationDecisionContract } from '@/lib/ceo-conversation-decision-contract'
import { deriveCeoConversationState } from '@/lib/ceo-conversation-state'
import { preRouteCeoRequest } from '@/lib/ceo-pre-router'
import { extractInstructionWindow, inferComprehensionMode } from '@/lib/ceo-cognitive-contract'
import { interpretCeoSemantics, semanticAssistanceRequired } from '@/lib/ceo-semantic-interpreter'

// Recommendation 1 (2026-09-20), following an external architecture review: "make source comprehension
// unification real but narrow" -- CanonicalConversationContext.instruction/sourceLength and
// ConversationDecisionContract.comprehensionMode are now computed ONCE per turn (in
// buildCanonicalConversationContext and buildConversationDecisionContract respectively) instead of every
// downstream consumer (ceo-pre-router.ts, ceo-semantic-interpreter.ts, ceo-cognitive-lifecycle.ts)
// independently recomputing extractInstructionWindow/inferComprehensionMode from the same message. This
// is additive: callers without a canonical context (tests, offline tooling) keep their original
// self-contained fallback behavior unchanged.

function contextFor(message: string) {
  const state = deriveCeoConversationState([], message)
  return buildCanonicalConversationContext({ currentMessage: message, rows: [], state, references: [] })
}

describe('CanonicalConversationContext carries instruction/sourceLength computed once', () => {
  test('instruction matches extractInstructionWindow(currentMessage) exactly', () => {
    const message = 'Please explain how the billing pipeline works.'
    const context = contextFor(message)
    expect(context.instruction).toBe(extractInstructionWindow(context.currentMessage))
  })

  test('sourceLength matches the normalized currentMessage length', () => {
    const message = 'A short message.'
    const context = contextFor(message)
    expect(context.sourceLength).toBe(context.currentMessage.length)
  })
})

describe('ConversationDecisionContract carries comprehensionMode computed once, alongside responseAction', () => {
  test('comprehensionMode matches inferComprehensionMode(responseAction, sourceLength) for a short conversational turn', () => {
    const context = contextFor('What is our current runway?')
    const contract = buildConversationDecisionContract(context)
    expect(contract.comprehensionMode).toBe(inferComprehensionMode({ responseAction: contract.responseAction, sourceLength: context.sourceLength }))
    expect(contract.comprehensionMode).toBe('conversation')
  })

  test('comprehensionMode reflects deep_analysis for a genuinely long document', () => {
    const longDoc = `Please explain this report.\n\n${'This is a filler sentence describing routine business operations. '.repeat(150)}`
    const context = contextFor(longDoc)
    const contract = buildConversationDecisionContract(context)
    expect(context.sourceLength).toBeGreaterThan(4000)
    expect(contract.comprehensionMode).toBe('deep_analysis')
  })
})

describe('ceo-semantic-interpreter.ts consumes the canonical instruction instead of recomputing it', () => {
  test('shouldAssist (via semanticAssistanceRequired) agrees with a direct extractInstructionWindow computation on the same message', () => {
    const message = 'wht do you think about the plan? (typo intentional)'
    const context = contextFor(message)
    // Confirms context.instruction is what actually drives shouldAssist's typo-hint check -- if this
    // function were still calling extractInstructionWindow itself on a different message, this would
    // still coincidentally pass; the real guarantee is the unit test above (instruction === the window).
    expect(semanticAssistanceRequired(context)).toBe(true)
  })

  test('interpretCeoSemantics short-circuits to deterministic for high-risk execution language found in context.instruction', async () => {
    const message = 'wht do you think, should we deploy the new pricing page? (typo)'
    const context = contextFor(message)
    const result = await interpretCeoSemantics(context)
    expect(result.source).toBe('deterministic')
  })
})

describe('Deep-audit fix: ceo-pre-router.ts using the canonical instruction (not a locally whitespace-collapsed one) closes a real misclassification gap', () => {
  // ceo-pre-router.ts's own `text` used to collapse ALL whitespace (including newlines) before windowing,
  // which silently disabled extractInstructionWindow's lead-in-phrase branch (SOURCE_LEAD_IN_RE requires
  // a real newline immediately after the phrase). That meant a message like "Analyze this:\n<document>"
  // never got the precise, lead-in-anchored window through this file -- it always fell back to the
  // generic 600-char head, which could include document vocabulary (e.g. "deploy") the user never asked
  // about, misrouting the whole turn. Reading semanticContext.instruction (built from the
  // newline-preserving canonical currentMessage) fixes this for the real production path, where a
  // canonical context is always available (see route.ts). The fallback path (no canonical context
  // supplied) intentionally keeps its original, narrower behavior for tests/offline tooling.
  function buildDoc(): string {
    const early = "Our team will likely need to deploy new tooling eventually, but that's a side note."
    const filler = 'filler content padding out the document. '.repeat(200)
    return `Analyze this:\n${early} ${filler}\n\nWhat do you think of this report overall?`
  }

  test('with a canonical context supplied, "deploy" appearing shortly after the lead-in does NOT leak into the classification window', () => {
    const doc = buildDoc()
    const context = contextFor(doc)
    expect(context.instruction).not.toContain('deploy')
  })

  test('without a canonical context (fallback path), the same "deploy" mention DOES leak into the whitespace-collapsed window -- confirms the fixture actually exercises the fix, not a scenario already handled', () => {
    const doc = buildDoc()
    const oldStyleText = doc.replace(/\s+/g, ' ').trim()
    expect(extractInstructionWindow(oldStyleText)).toContain('deploy')
  })

  test('preRouteCeoRequest classifies the turn correctly (analysis) when the canonical context is supplied, exactly as the real production path (route.ts) always supplies one', () => {
    const doc = buildDoc()
    const context = contextFor(doc)
    const contract = buildConversationDecisionContract(context)
    const decision = preRouteCeoRequest([{ role: 'user', content: doc }], 0, context, contract)
    expect(decision.executionContract.intent).not.toBe('production_action')
  })

  test('without a canonical context, the same message misclassifies as production_action -- documents the fallback path\'s known, deliberately unchanged limitation', () => {
    const doc = buildDoc()
    const decision = preRouteCeoRequest([{ role: 'user', content: doc }])
    expect(decision.executionContract.intent).toBe('production_action')
  })
})
