import { describe, expect, test } from 'bun:test'
import { preRouteCeoRequest } from '@/lib/ceo-pre-router'
import { classifyCeoBehavioralModes } from '@/lib/ceo-behavioral-policy'
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
  })
})

// Stage 0 structural baseline: documents, in a way that will fail loudly the moment Stage 1/Stage 2
// land, exactly what today's "too many overlapping authorities" shape looks like in source -- so
// each later stage's PR has a concrete, mechanical "did I actually change what I meant to change"
// check, not just a vibe. Update (don't delete) these assertions as each stage ships: flip the
// expectation and note which stage/PR changed it.
describe('CEO kernel migration -- Stage 0 structural baseline (source-text, pre-migration)', () => {
  test('route.ts still runs the CEO lifecycle twice for operational_orchestrator requests (Stage 1 target)', () => {
    const route = readFileSync('src/app/api/agent/route.ts', 'utf8')
    const runCount = (route.match(/runCeoCognitiveLifecycle\(/g) ?? []).length
    // One call in the ceo_lifecycle branch, one call ("synthesis") in the operational_orchestrator
    // branch after runOrchestrator() already produced a full answer. Stage 1 collapses this to one
    // call reachable from both branches -- when it does, update this to expect(runCount).toBe(1) (or
    // however the consolidated call site is counted) and reference the Stage 1 PR here.
    expect(runCount).toBe(2)
    expect(route).toContain('runOrchestrator(')
  })

  test('two independent decide-stages still exist (Stage 2 target)', () => {
    const kernel = readFileSync('src/lib/ceo-cognitive-kernel.ts', 'utf8')
    const contract = readFileSync('src/lib/ceo-conversation-decision-contract.ts', 'utf8')
    // buildCeoDecisionPlan and buildConversationDecisionContract are both real, both run on every
    // turn, and both independently decide intent/evidence/response-action shape today. Stage 2
    // consolidates them into one authoritative decision -- when it does, this test should be
    // rewritten to assert the single surviving decision function's shape instead.
    expect(kernel).toContain('export function buildCeoDecisionPlan')
    expect(contract).toContain('export function buildConversationDecisionContract')
  })

  test('behavioral modes are still an unarbitrated regex union (Stage 3 target)', () => {
    const policy = readFileSync('src/lib/ceo-behavioral-policy.ts', 'utf8')
    // classifyCeoBehavioralModes returns every mode whose regex matched, in CEO_BEHAVIORAL_MODES
    // order, with no step that picks a single leading mode. Stage 3 adds that arbitration inside
    // the Stage 2 consolidated decision -- when it does, update this to assert the new
    // leading-mode field instead of the plain array return.
    expect(policy).toContain('modes = new Set<CeoBehavioralMode>()')
    expect(policy).toContain('return CEO_BEHAVIORAL_MODES.filter((mode) => modes.has(mode))')
  })
})
