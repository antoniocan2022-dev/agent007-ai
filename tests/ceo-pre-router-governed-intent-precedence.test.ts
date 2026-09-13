import { describe, expect, test } from 'bun:test'
import { preRouteCeoRequest } from '@/lib/ceo-pre-router'
import { buildCanonicalConversationContext } from '@/lib/ceo-cognitive-conversation'
import { deriveCeoConversationState } from '@/lib/ceo-conversation-state'

const user = (content: string) => [{ role: 'user' as const, content }]
const canonicalContextFor = (message: string, semanticInterpretation?: Record<string, unknown>) => {
  const state = deriveCeoConversationState([], message)
  return buildCanonicalConversationContext({ currentMessage: message, rows: [], state, references: [], memories: [], semanticInterpretation })
}

// Deep-audit fix (2026-09-13): the LLM-assisted intentHint used to be able to silently replace a
// deterministically-classified tool_action, or (for tool_action/production_action/mission_action) have
// its own governed evidence/tool requirements clobbered by canonicalDecision's coarser toolRequirement
// enum -- both traced to real grounding loss (a dropped organization-context module) on an actual
// production/tool command whenever the two layers disagreed. See ceo-pre-router.ts's
// deterministicIntentIsGoverned and governedByDeterministicIntent for the fix.
describe('pre-router: deterministic tool/production/mission classification cannot be downgraded', () => {
  test('a deterministic tool_action keeps its governed evidence/tool requirements without a semantic context', () => {
    const decision = preRouteCeoRequest(user('Update our pricing strategy across all products.'))
    expect(decision.executionContract.intent).toBe('tool_action')
    expect(decision.executionContract.toolRequired).toBe(true)
    expect(decision.executionContract.orchestrationOwner).toBe('operational_orchestrator')
  })

  test('a deterministic tool_action survives even when a confident semantic context suggests a different intent', () => {
    // A canonical context whose semantic interpretation is confidently model-assisted and disagrees
    // with the deterministic classifier -- built directly rather than mocked, so this exercises the
    // real merge path in ceo-pre-router.ts, not a stub.
    const message = 'Update our pricing strategy across all products.'
    const context = canonicalContextFor(message, { source: 'model_assisted', confidence: 0.95, suggestedIntent: 'decision' })
    const decision = preRouteCeoRequest(user(message), 0, context)
    expect(decision.executionContract.intent).toBe('tool_action')
    expect(decision.executionContract.toolRequired).toBe(true)
    expect(decision.executionContract.orchestrationOwner).toBe('operational_orchestrator')
  })

  test('research intent still gets narrowed to internal-only evidence by curiosity when the bare "verify" keyword does not imply real external lookup', () => {
    const message = 'Verify our current compliance status before adding integrations.'
    const context = canonicalContextFor(message)
    const decision = preRouteCeoRequest(user(message), 0, context)
    expect(decision.executionContract.evidenceClass).toBe('none')
  })
})
