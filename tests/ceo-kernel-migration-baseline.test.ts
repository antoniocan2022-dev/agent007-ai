import { describe, expect, test } from 'bun:test'
import { preRouteCeoRequest } from '@/lib/ceo-pre-router'
import { classifyCeoBehavioralModes, selectLeadingCeoBehavioralMode } from '@/lib/ceo-behavioral-policy'
import { readFileSync } from 'node:fs'

const user = (content: string) => [{ role: 'user' as const, content }]

// Stage 0 of the CEO Conversation Kernel migration (canonical sequence: Understand -> Remember ->
// Decide -> Reason/Research -> Act -> Verify -> Respond). This file locks in TODAY's actual
// classification/routing behavior for five representative request classes BEFORE any of Stages
// 1-4 touch the pipeline, so every later stage has a concrete tripwire: if a later change silently
// reclassifies any of these five, one of these tests fails and says exactly which one and how.
//
// This does not test route.ts's SSE/DB-writing request handler directly (its real dependency graph
// -- auth, Prisma, orchestrator tool dispatch -- is not live-importable in this sandbox, the same
// constraint documented elsewhere in this test suite). It tests at the same boundary the rest of
// this suite already uses: preRouteCeoRequest's deterministic classification, which is what decides
// which branch of route.ts (single-pass CEO lifecycle vs. the operational_orchestrator double-pass
// Stage 1 targets) a real request would take.
describe('CEO kernel migration -- Stage 0 baseline (pre-router classification)', () => {
  test('greeting: fast conversational path, no tools, no evidence', () => {
    const decision = preRouteCeoRequest(user('Hi!'))
    expect(decision.route).toBe('fast')
    expect(decision.executionContract.intent).toBe('conversation')
    expect(decision.executionContract.toolRequired).toBe(false)
    expect(decision.executionContract.orchestrationOwner).toBe('ceo_lifecycle')
  })

  test('business question: full path, ceo_lifecycle-owned, no forced tool requirement', () => {
    const decision = preRouteCeoRequest(user('What should we do about our pricing strategy this quarter?'))
    expect(decision.executionContract.orchestrationOwner).toBe('ceo_lifecycle')
    expect(['decision', 'analysis', 'opinion']).toContain(decision.executionContract.intent)
  })

  test('stock research: full path, ceo_lifecycle-owned, public_equity domain, tools required', () => {
    const decision = preRouteCeoRequest(user('Tell me about NVDA stock.'))
    expect(decision.executionContract.intent).toBe('research')
    expect(decision.executionContract.domain).toBe('public_equity')
    expect(decision.executionContract.toolRequired).toBe(true)
    expect(decision.executionContract.orchestrationOwner).toBe('ceo_lifecycle')
    expect(decision.route).toBe('full')
  })

  // This is the exact request class Stage 1 changes: today it routes to 'operational_orchestrator',
  // which is what makes route.ts run runOrchestrator() and then runCeoCognitiveLifecycle() a second
  // time on its output. After Stage 1 ships, this classification itself should NOT change -- Stage 1
  // changes what route.ts DOES with an operational_orchestrator decision, not the classification
  // that produces one. If this test's orchestrationOwner assertion ever changes, that's a pre-router
  // change, not a Stage 1 change, and deserves its own scrutiny.
  test('action request: full path, operational_orchestrator-owned, tools required -- the double-pipeline trigger', () => {
    const decision = preRouteCeoRequest(user('Fix the Vercel deployment problem.'))
    // Classifies as 'tool_action', not 'production_action' -- \bdeploy\b requires a word boundary
    // on both sides and "deployment" doesn't have one after "deploy", so the production-keyword
    // regex doesn't match here; the imperative "fix" phrasing falls through to tool_action instead.
    // Both intents carry orchestrationOwner: 'operational_orchestrator' (verified directly in
    // ceo-pre-router.ts), so this is still the exact request class Stage 1 targets.
    expect(decision.executionContract.intent).toBe('tool_action')
    expect(decision.executionContract.orchestrationOwner).toBe('operational_orchestrator')
    expect(decision.executionContract.toolRequired).toBe(true)
    expect(decision.route).toBe('full')
  })

  test('personal/frustration message: conversational, no tools, "friend" behavioral mode leads', () => {
    const decision = preRouteCeoRequest(user("I'm feeling really exhausted and frustrated with how things are going."))
    expect(decision.executionContract.intent).toBe('conversation')
    expect(decision.executionContract.toolRequired).toBe(false)
    const modes = classifyCeoBehavioralModes({ intent: decision.executionContract.intent, responseAction: 'answer', currentMessage: "I'm feeling really exhausted and frustrated with how things are going." })
    expect(modes).toContain('friend')
    // Stage 3: this message triggers only 'friend', so it's trivially also the arbitrated leading mode
    // -- the real arbitration test (multiple modes, leading mode is NOT the one CEO_BEHAVIORAL_MODES'
    // fixed order would put first) lives in ceo-behavioral-policy-arbitration.test.ts.
    expect(selectLeadingCeoBehavioralMode(modes)).toBe('friend')
  })
})

// Stage 0 structural baseline: documents, in a way that will fail loudly the moment Stage 1/Stage 2
// land, exactly what today's "too many overlapping authorities" shape looks like in source -- so
// each later stage's PR has a concrete, mechanical "did I actually change what I meant to change"
// check, not just a vibe. Update (don't delete) these assertions as each stage ships: flip the
// expectation and note which stage/PR changed it.
//
// Stage 5 (2026-09-18): all five stages of the CEO Conversation Kernel migration are now shipped.
// This describe block's tests were updated at each stage per this comment's own instruction -- but
// two of them (Stage 1, Stage 2) had their EXPECTATION VALUES correctly kept from Stage 0 (since the
// literal source-text shape they check genuinely didn't change) while their COMMENTS kept describing
// the original pre-implementation speculation as if it were still the plan, well after the real
// (different, and correctly so) design had shipped. Both are corrected below as part of Stage 5's own
// "remove dead duplicate paths" mandate -- stale documentation describing a plan that was deliberately
// not followed is its own kind of dead weight.
//
// Phase 2 (external audit, 2026-09-19), issue 7: this migration's regression discipline across every
// stage was "hold the pre-existing failure baseline exactly constant, let the pass count grow as tests
// are added" -- the full local suite has never been reported or treated as passing outright. Reported
// as "full regression suite clean" in chat summaries, that reads as zero failures, which was never
// true and was never the bar being enforced. The actual, held-constant baseline (unchanged since Stage
// 0, sandbox-environment artifacts unrelated to this migration -- see this file's own module-resolution
// notes elsewhere in the suite): 49 pre-existing failures, 13 pre-existing errors, 7 skipped. "Clean"
// means these Phase 1/Phase 2 changes introduced no NEW failures against that fixed baseline, not that
// the suite has none. State it that way going forward, here and in any report of this suite's health.
describe('CEO kernel migration -- Stage 0 structural baseline (source-text, pre-migration)', () => {
  test('route.ts still has two runCeoCognitiveLifecycle call sites, but the second is now conditionally skipped (Stage 1 shipped)', () => {
    const route = readFileSync('src/app/api/agent/route.ts', 'utf8')
    const runCount = (route.match(/runCeoCognitiveLifecycle\(/g) ?? []).length
    // Stage 5 fresh-audit finding: this test's own comment used to say Stage 1 would "collapse this
    // to one call reachable from both branches" -- that was the original speculative plan, and it is
    // NOT what actually shipped. What shipped instead (Stage 1a: hoist the per-iteration
    // classification runOrchestrator's tool loop was redundantly redoing; Stage 1b:
    // tryOperationalDirectResponse) is a conditional SKIP, not a call-site merge: route.ts still has
    // two literal runCeoCognitiveLifecycle( call sites in source (one in the ceo_lifecycle branch,
    // one -- "synthesis" -- in the operational_orchestrator branch's `else`), but the second one now
    // only executes when tryOperationalDirectResponse's quality-gate check on the orchestrator's own
    // answer does NOT already pass. A merged single call site would have meant either branch paying
    // for context/modules the other doesn't need; the conditional-skip design was the lower-risk
    // choice Stage 1a's investigation concluded on. See ceo-operational-direct-response.ts for the
    // actual mechanism and route.ts's `if (direct) { ... } else { ... runCeoCognitiveLifecycle(...) }`
    // for where the second call is now gated.
    expect(runCount).toBe(2)
    expect(route).toContain('runOrchestrator(')
    expect(route).toContain('tryOperationalDirectResponse(')
    expect(route).toContain('if (direct) {')
  })

  test('buildCeoDecisionPlan and buildConversationDecisionContract both still exist, by design, and each now builds exactly once per turn (Stage 2 shipped)', () => {
    const kernel = readFileSync('src/lib/ceo-cognitive-kernel.ts', 'utf8')
    const contract = readFileSync('src/lib/ceo-conversation-decision-contract.ts', 'utf8')
    // Stage 5 fresh-audit finding: this test's own comment used to say Stage 2 would consolidate the
    // two functions "into one authoritative decision" and should be "rewritten to assert the single
    // surviving decision function's shape instead" -- that was the original speculative framing, and
    // it is NOT what shipped. Stage 2's investigation (a real call-graph audit of curiosity, the
    // evidence planner, and the quality gate) found the two functions serve genuinely different,
    // largely non-overlapping concerns -- DecisionPlan is execution/orchestration policy,
    // ConversationDecisionContract is conversational/semantic decision -- with only responseAction
    // bridging them at the quality gate. A literal type-level merge would have touched ~20 call sites
    // for no correctness or performance benefit. The REAL bug Stage 2 fixed was that
    // buildConversationDecisionContract (a pure function of canonicalSemanticContext alone) was being
    // rebuilt independently in up to four places on a single turn; composeCeoContext now builds it
    // exactly once and threads it through reuseSemanticContext -- see ceo-context-composer.ts. Both
    // functions staying separate, real, and exported is the correct end state, not a leftover.
    expect(kernel).toContain('export function buildCeoDecisionPlan')
    expect(contract).toContain('export function buildConversationDecisionContract')
  })

  test('behavioral modes are now arbitrated into one leading mode, not an unranked regex union (Stage 3 shipped)', () => {
    const policy = readFileSync('src/lib/ceo-behavioral-policy.ts', 'utf8')
    // classifyCeoBehavioralModes still returns every mode whose regex matched, in CEO_BEHAVIORAL_MODES
    // order (unchanged -- still useful as supporting-mode context for the rendered prompt), but
    // buildCeoBehavioralPolicy now also arbitrates a single leadingMode from a fixed priority order
    // (CEO_BEHAVIORAL_MODE_PRIORITY), and CeoBehavioralPolicy carries that as its own field.
    expect(policy).toContain('modes = new Set<CeoBehavioralMode>()')
    expect(policy).toContain('return CEO_BEHAVIORAL_MODES.filter((mode) => modes.has(mode))')
    expect(policy).toContain('CEO_BEHAVIORAL_MODE_PRIORITY')
    expect(policy).toContain('export function selectLeadingCeoBehavioralMode')
    expect(policy).toContain('leadingMode: CeoBehavioralMode')
  })
})
