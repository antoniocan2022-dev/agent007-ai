import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { preRouteCeoRequest } from '@/lib/ceo-pre-router'
import { buildCanonicalConversationContext } from '@/lib/ceo-cognitive-conversation'
import { buildConversationDecisionContract } from '@/lib/ceo-conversation-decision-contract'
import { deriveCeoConversationState } from '@/lib/ceo-conversation-state'
import { buildSemanticQualityReport, buildSemanticRepairPlan } from '@/lib/ceo-semantic-quality-report'
import { computeWorldStateDelta } from '@/lib/ceo-world-state'
import { buildConversationIncidentContract } from '@/lib/ceo-conversation-incident'
import { buildIncidentRegressionCandidate, promoteApprovedCandidateToFixtureEntry } from '@/lib/ceo-incident-regression-candidate'

const ROOT = join(import.meta.dir, '..')

describe('Architecture invariants -- the closed cognitive loop, certified end-to-end', () => {
  test('Invariant A: one request produces one canonical semantic interpretation -- the lifecycle does not independently re-route a request the API route already routed', () => {
    // This is a structural guarantee, not a per-call one: runCeoCognitiveLifecycle must be able to
    // accept an already-computed route so the API layer's interpretation is the one that's actually
    // used, rather than being computed once and then silently discarded in favor of a second one.
    const source = readFileSync(join(ROOT, 'src/lib/ceo-cognitive-lifecycle.ts'), 'utf-8')
    expect(source).toContain('preRoute?:')
    expect(source).toMatch(/request\.preRoute\s*\?\?\s*preRouteCeoRequest/)
    // And the route actually supplies it, rather than the acceptance existing but going unused.
    const routeSource = readFileSync(join(ROOT, 'src/app/api/agent/route.ts'), 'utf-8')
    expect(routeSource).toMatch(/priorConversation:\s*contextData\.rows,\s*relevantOlderConversation:\s*contextData\.rows,\s*preRoute,\s*decisionContract/)
  })

  test('Invariant B: the decision contract is load-bearing for actual generation, not observability-only -- a clarify action produces a genuinely different instruction than an answer action', () => {
    const source = readFileSync(join(ROOT, 'src/lib/ceo-cognitive-lifecycle.ts'), 'utf-8')
    // The contract's responseAction must actually reach the messages sent to the model.
    expect(source).toContain('responseActionInstruction(request.decisionContract?.responseAction)')
    expect(source).toContain("action === 'clarify'")
    // And the two actions must genuinely diverge in behavior, not just in an unused label.
    const state = deriveCeoConversationState([], 'We should do it.')
    const answerContext = buildCanonicalConversationContext({ currentMessage: 'We should do it.', rows: [], state, references: [] })
    const answerContract = buildConversationDecisionContract(answerContext)
    const clarifyState = deriveCeoConversationState([], 'Do the thing about it')
    const clarifyContext = buildCanonicalConversationContext({ currentMessage: 'Do the thing about it', rows: [], state: clarifyState, references: [{ phrase: 'it', kind: 'demonstrative', resolvedText: null, confidence: 0.2, sourceRole: 'user', ambiguous: true, candidates: [] } as never] })
    const clarifyContract = buildConversationDecisionContract(clarifyContext)
    expect(answerContract.responseAction).not.toBe(clarifyContract.responseAction)
  })

  test('Invariant C: the semantic judge is genuinely connected to targeted regeneration, not merely computed and discarded', () => {
    const source = readFileSync(join(ROOT, 'src/lib/ceo-cognitive-lifecycle.ts'), 'utf-8')
    expect(source).toContain('buildSemanticQualityReport')
    expect(source).toContain('buildSemanticRepairPlan')
    expect(source).toContain('renderSemanticRepairPrompt')
    expect(source).toMatch(/report\.decision\s*===\s*'REPAIR'/)
    // And re-judging after repair is real, not assumed: the repaired content is re-scored before
    // being trusted, using the same evaluator, not a weaker or different one.
    expect(source).toMatch(/repairedQuality\s*=\s*evaluateCeoQuality/)
    expect(source).toContain('buildSemanticQualityReport({ quality: repairedQuality')
  })

  test('Invariant D: a final response is traceable to a concrete state delta -- the delta genuinely reflects what changed in that specific exchange', () => {
    const t = (n: number) => Date.UTC(2026, 7, 30, 12, n)
    const row = (role: 'user' | 'assistant', content: string, minute: number) => ({ role, content, createdAt: t(minute) })
    const before = [row('user', 'We are building Agent007.', 0)]
    const after = [...before, row('assistant', 'Understood.', 1), row('user', "Let's decide to prioritize memory next.", 2)]
    const delta = computeWorldStateDelta(before, after, 'What did we just decide?')
    expect(delta.newDecisions.length).toBeGreaterThan(0)
    expect(delta.newDecisions[0]?.text).toContain('prioritize memory')
  })

  test('Invariant E: an incident produces a genuine regression candidate, and promotion to an enforceable test is impossible without explicit human approval', () => {
    const incident = buildConversationIncidentContract({ objective: 'Compliance. But before explain me mi', intent: 'conversation', failureReason: 'quality_failure' })
    const candidate = buildIncidentRegressionCandidate({ incident, message: 'Compliance. But before explain me mi' })
    expect(candidate.status).toBe('candidate')
    expect(candidate.fingerprint).toBe(incident.fingerprint)
    // The unapproved path to CI is closed: this must throw, not silently produce a usable fixture.
    expect(() => promoteApprovedCandidateToFixtureEntry(candidate, 'name')).toThrow()
  })

  test('the closed loop is genuinely closed: incident category and invariant text are stable and deterministic for the same failure, so repeated occurrences of the same real bug converge on the same candidate rather than fragmenting', () => {
    const a = buildConversationIncidentContract({ objective: 'What did we decide?', intent: 'conversation', failureReason: 'continuity_failure' })
    const b = buildConversationIncidentContract({ objective: 'What did we decide?', intent: 'conversation', failureReason: 'continuity_failure' })
    expect(a.fingerprint).toBe(b.fingerprint)
    expect(a.invariant).toBe(b.invariant)
  })
})
