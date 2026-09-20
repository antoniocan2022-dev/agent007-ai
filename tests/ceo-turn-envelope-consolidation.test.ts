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

// Production incident (2026-09-20): a real user asked for "a deep comprehension of long text" over a
// pasted business report and got back a canned self-assessment status report instead ("Partners: No
// partnerships tracked yet... Executive decisions: 37 recorded..."), never engaging with the document at
// all. Root cause: userIntentHint (ceo-cognitive-conversation.ts) was the one intent branch still scanning
// the FULL raw message for self-assessment/readiness/capability-assessment phrasing -- deliberately left
// unwindowed on the reasoning that such phrasing was "rare... unlikely to appear misleadingly inside
// pasted source material." Real business/strategy reports routinely use "readiness assessment" or
// "capability assessment" as ordinary section language, and self_assessment is the one intent this
// codebase treats as AUTHORITATIVE (unoverridable even by a confident model-assisted suggestion -- see
// deterministicIntentIsAuthoritative in buildCanonicalConversationContext), so a single such phrase
// anywhere in a long document could hijack the entire turn.
describe('Production-incident fix: a business document merely mentioning "readiness/capability assessment" no longer hijacks the whole turn into self-assessment', () => {
  function buildReadinessDoc(): string {
    const early = 'Q3 Strategic Review: Market Position and Platform Roadmap. Our platform grew subscription revenue by 14% quarter over quarter.'
    // "Readiness Assessment" and "Capability Assessment" as ordinary section headers -- exactly the
    // phrasing a real business/strategy report legitimately uses, unrelated to the user's own ask.
    const middle = 'Section 4: Organizational Readiness Assessment. This section reviews our operational readiness across staffing, tooling, and process maturity. Section 5: Technology Capability Assessment. This section reviews our current technology stack against near-term product requirements.'
    const filler = 'Customer support satisfaction scores remained within the target band this quarter. '.repeat(150)
    return `Please give me a deep comprehension of this report and summarize the key points.\n\n${early}\n\n${filler}\n\n${middle}\n\n${filler}\n\nWhat should we prioritize next quarter?`
  }

  test('a "readiness assessment"/"capability assessment" section deep in the document does not leak into the classification window', () => {
    const doc = buildReadinessDoc()
    const context = contextFor(doc)
    expect(context.instruction.toLowerCase()).not.toContain('readiness assessment')
    expect(context.instruction.toLowerCase()).not.toContain('capability assessment')
  })

  test('the canonical context does not classify this as self_assessment -- it is a document-comprehension request', () => {
    const doc = buildReadinessDoc()
    const context = contextFor(doc)
    expect(context.intentHint).not.toBe('self_assessment')
  })

  test('preRouteCeoRequest does not route this into the self-assessment fast lane, which would skip Phase 3 hierarchical comprehension entirely', () => {
    const doc = buildReadinessDoc()
    const context = contextFor(doc)
    const contract = buildConversationDecisionContract(context)
    const decision = preRouteCeoRequest([{ role: 'user', content: doc }], 0, context, contract)
    expect(decision.executionContract.intent).not.toBe('self_assessment')
  })

  test('without windowing (reproducing the old bug directly), the same phrasing DOES match the self-assessment regex -- confirms the fixture actually exercises the fix', () => {
    const doc = buildReadinessDoc()
    const oldStyleFullTextMatch = /\b(?:readiness\s+assessment|capability\s+assessment)\b/i.test(doc)
    expect(oldStyleFullTextMatch).toBe(true)
  })

  test('a genuinely short, explicit self-assessment request is still recognized correctly (no regression)', () => {
    const context = contextFor('Can you do a self-assessment of your current capabilities?')
    expect(context.intentHint).toBe('self_assessment')
  })
})

// Follow-up fix (2026-09-20): windowing alone was not sufficient -- a "readiness assessment"/"capability
// assessment" section sitting in the message's own HEAD or TAIL (not buried mid-document) still
// false-positived post-windowing, because the three bare business-term alternatives in userIntentHint had
// no self-reference requirement at all, unlike every other alternative in that regex. A closing
// "Recommendations & Readiness Assessment" section is an extremely common place for this exact phrasing
// to land in a real report's tail.
describe('Follow-up fix: bare "readiness/capability assessment" near the head or tail still requires genuine self-reference', () => {
  function buildTrailingReadinessDoc(): string {
    const early = 'Please give me a deep comprehension of this report and summarize the key points.'
    const filler = 'Customer support satisfaction scores remained within the target band this quarter. '.repeat(150)
    // The section header sits in the document's own TAIL, exactly where extractInstructionWindow's
    // fallback window keeps it, with no self-referential language anywhere nearby.
    const closing = 'Section 9: Recommendations and Capability Assessment. This section reviews our go-to-market readiness assessment for next quarter, covering staffing, tooling, and process maturity.'
    return `${early}\n\n${filler}\n\n${closing}`
  }

  test('the phrase lands inside the classification window (confirms the fixture exercises the tail, not the buried-mid-document case)', () => {
    const doc = buildTrailingReadinessDoc()
    const context = contextFor(doc)
    expect(context.instruction.toLowerCase()).toContain('capability assessment')
  })

  test('with no self-reference anywhere in the window, it is still not classified as self_assessment', () => {
    const doc = buildTrailingReadinessDoc()
    const context = contextFor(doc)
    expect(context.intentHint).not.toBe('self_assessment')
  })

  test('preRouteCeoRequest does not route this into the self-assessment fast lane either', () => {
    const doc = buildTrailingReadinessDoc()
    const context = contextFor(doc)
    const contract = buildConversationDecisionContract(context)
    const decision = preRouteCeoRequest([{ role: 'user', content: doc }], 0, context, contract)
    expect(decision.executionContract.intent).not.toBe('self_assessment')
  })

  test('a genuine self-assessment request using the same bare "capability assessment" phrasing, but WITH self-reference nearby, still classifies correctly (no regression)', () => {
    const context = contextFor('Can you give me a capability assessment of Agent007?')
    expect(context.intentHint).toBe('self_assessment')
  })

  test('without the self-reference gate (reproducing the follow-up bug directly), the tail phrasing alone DOES match -- confirms the fixture actually exercises this fix', () => {
    const doc = buildTrailingReadinessDoc()
    const oldStyleBareMatch = /\b(?:readiness\s+assessment|system\s+readiness|capability\s+assessment)\b/i.test(doc)
    expect(oldStyleBareMatch).toBe(true)
  })
})
