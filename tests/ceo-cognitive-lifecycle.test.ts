import { describe, expect, test, afterEach } from 'bun:test'
import { preRouteCeoRequest, resolvePreRoute } from '@/lib/ceo-pre-router'
import { buildCeoDecisionPlan } from '@/lib/ceo-cognitive-kernel'
import { buildCeoExecutionPlan } from '@/lib/ceo-execution-plan'
import { evaluateCeoQuality } from '@/lib/ceo-response-quality-gate'
import { buildCeoDegradedResponse } from '@/lib/ceo-degraded-mode'
import { runGovernedProviderChat } from '@/lib/provider-runtime-v2'
import { runCeoCognitiveLifecycle, semanticSubstanceCheck, semanticContinuityCheck } from '@/lib/ceo-cognitive-lifecycle'
import { resetProviderHealthForTests } from '@/lib/provider-intelligence'
import { readFileSync } from 'node:fs'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  for (const key of ['GROQ_API_KEY', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'MISTRAL_API_KEY', 'CEREBRAS_API_KEY', 'OPENROUTER_API_KEY']) delete process.env[key]
})

const criticalAnswer = `# Recommendation\n\nDecision: proceed only after independent review and explicit verification of the deployment evidence. The recommended action is to advance the mission only when the evidence package is complete, the identified risks are understood, and the execution conditions are satisfied.\n\n## Evidence\n- Confirm the deployment identity and verify the exact release evidence before execution.\n- Confirm the independent review result and reconcile any material disagreement.\n- Preserve the supporting mission evidence so the decision remains auditable.\n\n## Risks\n- Deployment without complete evidence could create an irreversible production error.\n- Conflicting verification results require escalation rather than silent selection.\n- Missing current evidence means the system must not claim live confirmation.\n\n## Next Actions\n1. Complete the independent verification checkpoint.\n2. Record the final evidence and decision state.\n3. Proceed only when all mandatory gates are satisfied.`

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('CEO cognitive lifecycle', () => {
  test('fast requests remain fast, ambiguous resolves to full, and the DecisionPlan enforces the full cognitive floor', () => {
    const fast = preRouteCeoRequest([{ role: 'user', content: 'What is compound interest?' }])
    expect(fast.route).toBe('fast')
    expect(fast.taskClass).toBe('reasoning')
    expect(fast.adaptiveExecutionClass).toBe('fast')
    const fastPlan = buildCeoDecisionPlan({ messages: [{ role: 'user', content: 'What is compound interest?' }], preRoute: fast })
    expect(fastPlan.path).toBe('fast')

    const ambiguousMessages = ['Continue this.', 'What about the other one instead?', 'Also, can you check that again?', 'Can you help with that thing we discussed?']
    for (const content of ambiguousMessages) {
      const ambiguous = preRouteCeoRequest([{ role: 'user', content }])
      expect(ambiguous.route).toBe('ambiguous')
      expect(resolvePreRoute(ambiguous)).toBe('full')
      const plan = buildCeoDecisionPlan({ messages: [{ role: 'user', content }], preRoute: ambiguous })
      expect(['full', 'critical']).toContain(plan.path)
      expect(plan.reasoningStrategy).not.toBe('direct')
      expect(plan.maxEscalations).toBeGreaterThanOrEqual(1)
    }
  })

  test('self-assessment stays CEO-owned even when generic analysis keywords are present', () => {
    const content = 'Hows it going? make a sekf analysis and tell me if you are ready to mange businesses?'
    const decision = preRouteCeoRequest([{ role: 'user', content }])
    expect(decision.executionContract.intent).toBe('self_assessment')
    expect(decision.executionContract.orchestrationOwner).toBe('ceo_lifecycle')
    expect(decision.executionContract.toolRequired).toBe(false)
    expect(decision.executionContract.subagentsRequired).toBe(false)
    expect(decision.executionContract.maxRecoveries).toBe(0)
    expect(decision.route).toBe('fast')
    const plan = buildCeoDecisionPlan({ messages: [{ role: 'user', content }], preRoute: decision })
    expect(plan.path).toBe('fast')
    expect(plan.reasoningStrategy).toBe('direct')
    expect(plan.cognitiveDepth).toBe(0)
  })

  test('mission and complex requests produce richer DecisionPlans', () => {
    const content = 'Design a comprehensive strategy to launch Agent007 revenue operations in production.'
    const preRoute = preRouteCeoRequest([{ role: 'user', content }])
    const plan = buildCeoDecisionPlan({ messages: [{ role: 'user', content }], preRoute, missionId: 'mission-1' })
    expect(plan.path).toBe('critical')
    expect(plan.reasoningStrategy).toBe('independent_review')
    expect(plan.cognitiveDepth).toBe(4)
    expect(plan.maxEscalations).toBe(2)
  })

  test('execution plan materializes every declared reasoning strategy', () => {
    const executionContract = { intent: 'conversation' as const, evidenceClass: 'none' as const, domain: 'none' as const, operation: 'none' as const, temporalScope: 'none' as const, evidenceProfile: 'none' as const, evidenceRequirement: 'none' as const, executionRequirement: 'llm_only' as const, orchestrationOwner: 'ceo_lifecycle' as const, maxTurns: 2, maxRecoveries: 1, latencyBudgetMs: 15000, toolRequired: false, subagentsRequired: false, reason: 'test' }
    const plans = [
      buildCeoExecutionPlan({ requestId: 'fast', path: 'fast', objective: 'x', taskClass: 'reasoning', missionRelevant: false, requiredCapabilities: [], qualityTier: 'standard', reasoningStrategy: 'direct', cognitiveDepth: 0, verificationRequired: false, maxEscalations: 0, maxProviderAttempts: 1, latencyBudgetMs: 15000, executionContract }),
      buildCeoExecutionPlan({ requestId: 'deep', path: 'full', objective: 'x', taskClass: 'research', missionRelevant: false, requiredCapabilities: ['research'], qualityTier: 'high', reasoningStrategy: 'multi_pass', cognitiveDepth: 2, verificationRequired: true, maxEscalations: 1, maxProviderAttempts: 4, latencyBudgetMs: 60000, executionContract }),
      buildCeoExecutionPlan({ requestId: 'critical', path: 'critical', objective: 'x', taskClass: 'financial', missionRelevant: true, requiredCapabilities: ['verification'], qualityTier: 'critical', reasoningStrategy: 'independent_review', cognitiveDepth: 4, verificationRequired: true, maxEscalations: 2, maxProviderAttempts: 5, latencyBudgetMs: 90000, executionContract }),
    ]
    expect(plans[0].stages.map((stage) => stage.name)).toEqual(['primary'])
    expect(plans[1].stages.map((stage) => stage.name)).toEqual(['primary', 'refinement'])
    expect(plans[2].stages.map((stage) => stage.name)).toEqual(['primary', 'independent_review', 'synthesis'])
  })

  test('quality gate rejects weak objective coverage and unsupported live claims', () => {
    const weak = evaluateCeoQuality({ objective: 'Compare the financial risks and recommended next actions for the two options.', content: 'This is a long generic response with unrelated context and no actual comparison, risk analysis, or decision structure. '.repeat(8), path: 'full', reviewed: false, externalExecutionSucceeded: true })
    expect(weak.decision).toBe('ESCALATE')
    const unsupportedLiveClaim = evaluateCeoQuality({ objective: 'Give me the latest status.', content: 'The latest live verified status is complete and confirmed.', path: 'full', reviewed: false, externalExecutionSucceeded: true, evidenceProvided: false })
    expect(unsupportedLiveClaim.decision).toBe('ESCALATE')
    expect(unsupportedLiveClaim.checks.evidenceDiscipline).toBe(false)
  })

  test('critical responses require supporting evidence before PASS and LIVE_VERIFIED', () => {
    const reviewedWithoutEvidence = evaluateCeoQuality({ objective: 'Decide whether to deploy this mission and explain risks, evidence, and next actions.', content: criticalAnswer, path: 'critical', reviewed: true, externalExecutionSucceeded: true, evidenceProvided: false })
    expect(reviewedWithoutEvidence.decision).toBe('ESCALATE')
    expect(reviewedWithoutEvidence.evidenceState).toBe('PARTIAL_UNCONFIRMED')
    expect(reviewedWithoutEvidence.verificationStatus).toBe('INDEPENDENT_PASS')

    const now = Date.now()
    const evidenced = evaluateCeoQuality({
      objective: 'Decide whether to deploy this mission and explain risks, evidence, and next actions.',
      content: criticalAnswer,
      path: 'critical',
      reviewed: true,
      externalExecutionSucceeded: true,
      evidenceProvided: true,
      evidenceScope: 'live_system',
      evidenceFreshness: { observedAt: now, maxAgeMs: 60_000 },
    })
    expect(evidenced.decision).toBe('PASS')
    expect(evidenced.evidenceState).toBe('LIVE_VERIFIED')
    expect(evidenced.verificationStatus).toBe('INDEPENDENT_PASS')
  })

  test('degraded mode recovers relevant persistent evidence when providers are unavailable', async () => {
    const degraded = await buildCeoDegradedResponse({ objective: 'What should Agent007 do about the current mission plan?', missionId: 'mission-42', reason: 'All approved external providers failed.', recall: async () => [{ key: 'mission-42-priority', value: 'The mission priority is to preserve verified execution evidence before taking irreversible action.', category: 'mission', createdAt: Date.now(), score: 80, timesRecalled: 0 }] })
    expect(degraded.evidenceState).toBe('MEMORY_ONLY')
    expect(degraded.sourceKeys).toEqual(['mission-42-priority'])
    expect(degraded.content).toContain("already established")
    expect(degraded.content).toContain('preserve verified execution evidence')
  })

  test('degraded mode never fabricates live verification when no internal evidence exists', async () => {
    const degraded = await buildCeoDegradedResponse({ objective: 'What is the current market?', reason: 'All approved external providers failed.', recall: async () => [] })
    expect(degraded.evidenceState).toBe('PARTIAL_UNCONFIRMED')
    expect(degraded.content).not.toContain('current market')
    expect(degraded.content.toLowerCase()).not.toContain('verified live')
  })

  test('provider exclusion prefers an independent canonical provider without reintroducing retired providers', async () => {
    process.env.GROQ_API_KEY = 'test-groq'
    process.env.CLOUDFLARE_API_KEY = 'test-cloudflare'
    process.env.CLOUDFLARE_ACCOUNT_ID = 'account-123'
    const calls: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); const method = String(init?.method ?? 'GET'); calls.push(`${url}::${method}`)
      if (url.includes('groq.com') && method === 'GET') return jsonResponse({ data: [{ id: 'llama-3.3-70b-versatile' }] })
      if (url.includes('/models/search') && method === 'GET') return jsonResponse({ result: [{ name: '@cf/google/gemma-4-26b-a4b-it' }] })
      if (url.includes('cloudflare.com') && method === 'POST') return jsonResponse({ choices: [{ message: { content: 'independent review response' } }] })
      throw new Error(`unexpected provider call: ${url}`)
    }) as typeof fetch
    const result = await runGovernedProviderChat({ taskType: 'reasoning', messages: [{ role: 'user', content: 'Review this draft.' }], excludeProviders: ['groq'], maxProviderAttempts: 1 })
    expect(result.provider).toBe('cloudflare')
    expect(result.model).toBe('@cf/google/gemma-4-26b-a4b-it')
    expect(calls.some((call) => call.includes('api.z.ai'))).toBe(false)
  })

  test('CEO availability contract attempts validated reasoning before degraded mode', async () => {
    process.env.GROQ_API_KEY = 'test-groq'
    let getCalls = 0; let postCalls = 0
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); const method = String(init?.method ?? 'GET')
      if (method === 'GET' && url.includes('api.groq.com')) { getCalls++; return jsonResponse({ data: [{ id: 'llama-3.3-70b-versatile' }] }) }
      if (method === 'POST' && url.includes('api.groq.com')) { postCalls++; return jsonResponse({ error: { message: 'upstream unavailable' } }, 503) }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch
    const result = await runCeoCognitiveLifecycle({ messages: [{ role: 'user', content: 'hi' }], timeoutMs: 12000 })
    expect(result.degraded).toBe(true)
    expect(getCalls).toBeGreaterThanOrEqual(2)
    expect(postCalls).toBeGreaterThanOrEqual(2)
  })

  test('critical lifecycle executes primary → independent review → synthesis on canonical providers', async () => {
    process.env.GROQ_API_KEY = 'test-groq'
    process.env.CLOUDFLARE_API_KEY = 'test-cloudflare'
    process.env.CLOUDFLARE_ACCOUNT_ID = 'account-123'
    process.env.MISTRAL_API_KEY = 'test-mistral'
    const postProviders: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); const method = String(init?.method ?? 'GET')
      if (method === 'GET') {
        if (url.includes('api.groq.com')) return jsonResponse({ data: [{ id: 'llama-3.3-70b-versatile' }] })
        if (url.includes('/accounts/account-123/ai/models/search')) return jsonResponse({ result: [{ name: '@cf/google/gemma-4-26b-a4b-it' }] })
        if (url.includes('api.mistral.ai')) return jsonResponse({ data: [{ id: 'mistral-large-latest' }] })
      }
      if (method === 'POST') {
        if (url.includes('api.groq.com')) { postProviders.push('groq'); return jsonResponse({ choices: [{ message: { content: criticalAnswer } }] }) }
        if (url.includes('cloudflare.com')) { postProviders.push('cloudflare'); return jsonResponse({ choices: [{ message: { content: 'Review: add explicit evidence, risks, and a verification checkpoint before deployment.' } }] }) }
        if (url.includes('api.mistral.ai')) { postProviders.push('mistral'); return jsonResponse({ choices: [{ message: { content: criticalAnswer } }] }) }
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch
    const now = Date.now()
    const result = await runCeoCognitiveLifecycle({
      missionId: 'mission-critical-test',
      messages: [{ role: 'user', content: 'Decide the best mission strategy for Agent007 and explain the evidence, risks, and next actions.' }],
      timeoutMs: 30000,
      contextualEvidence: 'Verified live mission evidence is available for this controlled test.',
      evidenceScope: 'live_system',
      evidenceFreshness: { observedAt: now, maxAgeMs: 60_000 },
    })
    const canonical = new Set(['groq', 'cloudflare', 'mistral', 'cerebras', 'openrouter'])
    expect(postProviders.length).toBeGreaterThanOrEqual(3)
    expect(postProviders.every((provider) => canonical.has(provider))).toBe(true)
    expect(new Set(postProviders).size).toBeGreaterThanOrEqual(2)
    expect(result.executionPlan.stages.map((stage) => stage.name)).toEqual(['primary', 'independent_review', 'synthesis'])
    expect(result.quality.verificationStatus).toBe('INDEPENDENT_PASS')
    expect(result.evidenceState).toBe('LIVE_VERIFIED')
    expect(result.degraded).toBe(false)
  })

  test('critical lifecycle falls back to the primary answer instead of crashing to a generic degraded response when the independent-review/synthesis stage throws', async () => {
    process.env.GROQ_API_KEY = 'test-groq'
    process.env.CLOUDFLARE_API_KEY = 'test-cloudflare'
    process.env.CLOUDFLARE_ACCOUNT_ID = 'account-123'
    process.env.MISTRAL_API_KEY = 'test-mistral'
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); const method = String(init?.method ?? 'GET')
      if (method === 'GET') {
        if (url.includes('api.groq.com')) return jsonResponse({ data: [{ id: 'llama-3.3-70b-versatile' }] })
        if (url.includes('/accounts/account-123/ai/models/search')) return jsonResponse({ result: [{ name: '@cf/google/gemma-4-26b-a4b-it' }] })
        if (url.includes('api.mistral.ai')) return jsonResponse({ data: [{ id: 'mistral-large-latest' }] })
      }
      if (method === 'POST') {
        // Only the independent-review and synthesis stages fail here -- every provider, every attempt.
        // The escalation-repair stage (a different system prompt) and the primary stage still succeed,
        // simulating exactly the real production failure: a good primary answer already exists when a
        // later stage throws.
        const body = init?.body ? String(init.body) : ''
        if (body.includes('independent verification reviewer') || body.includes('final executive synthesizer')) return jsonResponse({ error: { message: 'simulated upstream failure' } }, 503)
        return jsonResponse({ choices: [{ message: { content: criticalAnswer } }] })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch
    const now = Date.now()
    const result = await runCeoCognitiveLifecycle({
      missionId: 'mission-critical-fallback-test',
      messages: [{ role: 'user', content: 'Decide the best mission strategy for Agent007 and explain the evidence, risks, and next actions.' }],
      timeoutMs: 30000,
      contextualEvidence: 'Verified live mission evidence is available for this controlled test.',
      evidenceScope: 'live_system',
      evidenceFreshness: { observedAt: now, maxAgeMs: 60_000 },
    })
    // Before the fix, the independent-review throw was uncaught: it unwound straight to the outer
    // catch before primaryQuality was ever computed, discarding the already-generated primary answer
    // and reporting a generic 'provider_error' degraded response with primaryQualityDecision: 'NOT_RUN'.
    expect(result.generation.primaryOutputProduced).toBe(true)
    expect(result.generation.primaryQualityDecision).not.toBe('NOT_RUN')
    // The escalation stage (using the surviving primary content) recovers a real, passing answer instead
    // of degrading the whole request.
    expect(result.degraded).toBe(false)
    expect(result.content).toContain('Recommendation')
  })

  test('escalation loop retries within its budget instead of abandoning it after one transient provider failure', async () => {
    // Real production incident (traced via live runtime logs, request 99a00917): the escalation call
    // itself failed on a transient provider error, and the old code unconditionally broke out of the
    // whole escalation loop on ANY error -- discarding the rest of decisionPlan.maxEscalations (2 for a
    // critical path) even though the budget allowed another attempt. This locks in the fix: a failed
    // escalation attempt no longer ends the loop early; the next attempt still runs within budget.
    //
    // Deliberately resets provider health/circuit-breaker state first: this is the one test in this file
    // that relies on the SAME small provider set failing then succeeding within one test, so leftover
    // recentFailures accumulated by earlier tests in this file (e.g. the independent-review/synthesis
    // failures two tests up) could otherwise push a circuit open before this test's own retry has a
    // chance to prove anything -- confirmed as the real cause of this test failing in CI on the first push
    // (both here and, independently, in the "critical lifecycle falls back..." test's shared provider
    // pool), not a flaw in the underlying escalation-loop fix itself.
    resetProviderHealthForTests()
    process.env.GROQ_API_KEY = 'test-groq'
    process.env.CLOUDFLARE_API_KEY = 'test-cloudflare'
    process.env.CLOUDFLARE_ACCOUNT_ID = 'account-123'
    process.env.MISTRAL_API_KEY = 'test-mistral'
    let escalationCalls = 0
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); const method = String(init?.method ?? 'GET')
      if (method === 'GET') {
        if (url.includes('api.groq.com')) return jsonResponse({ data: [{ id: 'llama-3.3-70b-versatile' }] })
        if (url.includes('/accounts/account-123/ai/models/search')) return jsonResponse({ result: [{ name: '@cf/google/gemma-4-26b-a4b-it' }] })
        if (url.includes('api.mistral.ai')) return jsonResponse({ data: [{ id: 'mistral-large-latest' }] })
      }
      if (method === 'POST') {
        const body = init?.body ? String(init.body) : ''
        if (body.includes('You are an escalation reviewer')) {
          escalationCalls++
          // Fail only the first escalation-tagged call, then succeed -- proving the second outer attempt
          // actually runs rather than the loop having given up after the first failure.
          //
          // Deliberately one raw call per outer attempt, not two: with only groq/cloudflare/mistral
          // configured and this request's taskType resolving to 'research' (TASK_CAPABILITIES.research
          // requires 'long-context', which neither governed groq model profile has), groq always fails
          // resolveGovernedModel with a silent, non-HTTP MODEL_NOT_GOVERNED error before any fetch call --
          // confirmed directly by instrumenting runGovernedProviderChat locally. So each outer escalation
          // attempt's own maxProviderAttempts:2 internal retry only ever produces one real HTTP call (to
          // mistral, the sole remaining governed candidate after cloudflare is excluded as the prior
          // stage's provider), not two. A threshold requiring 3 raw calls to succeed (as an earlier version
          // of this test assumed) can never be reached within maxEscalations:2's budget of 2 outer
          // attempts -- which is exactly why that version failed in CI without the underlying fix being at
          // fault (every other check in the same run passed).
          if (escalationCalls <= 1) return jsonResponse({ error: { message: 'simulated transient upstream failure' } }, 503)
          return jsonResponse({ choices: [{ message: { content: criticalAnswer } }] })
        }
        // Primary, independent-review, and synthesis all return weak, unstructured content so the overall
        // quality gate fails (ESCALATE) and the escalation loop is what has to recover the request.
        return jsonResponse({ choices: [{ message: { content: 'Too short.' } }] })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch
    const now = Date.now()
    const result = await runCeoCognitiveLifecycle({
      missionId: 'mission-escalation-retry-test',
      messages: [{ role: 'user', content: 'Decide the best mission strategy for Agent007 and explain the evidence, risks, and next actions.' }],
      timeoutMs: 30000,
      contextualEvidence: 'Verified live mission evidence is available for this controlled test.',
      evidenceScope: 'live_system',
      evidenceFreshness: { observedAt: now, maxAgeMs: 60_000 },
    })
    expect(result.degraded).toBe(false)
    expect(result.content).toContain('Recommendation')
    expect(result.generation.finalStage).toBe('escalation')
    expect(result.generation.escalationCount).toBeGreaterThanOrEqual(2)
    // Reset again so the failures this test intentionally caused don't leave a circuit open for any
    // later test in this file.
    resetProviderHealthForTests()
  })

  // Deep-audit finding, root-caused against a real failing production trace: when the quality gate
  // rejects a response and soft-pass isn't eligible, the lifecycle used to call tryDegraded with
  // availabilityAttempted hardcoded to true WITHOUT ever actually attempting a validated-provider
  // recovery -- a false claim that skipped the one real last-resort chance and went straight to the
  // canned "I couldn't reliably complete that specific request..." template, even with a genuinely
  // available provider sitting right there. Live trace showed exactly this shape: primary generation
  // technically succeeded (ESCALATE, not an error), one escalation ran and still didn't pass, and the
  // final response was the generic bail-out despite zero actual provider outage. This proves the fix:
  // a working provider IS now used for real recovery content instead of the canned template.
  test('quality-gate-driven degrade genuinely attempts provider recovery instead of skipping straight to the canned template', async () => {
    resetProviderHealthForTests()
    process.env.GROQ_API_KEY = 'test-groq'
    let nonProbeCalls = 0
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); const method = String(init?.method ?? 'GET')
      if (method === 'GET' && url.includes('api.groq.com')) return jsonResponse({ data: [{ id: 'llama-3.3-70b-versatile' }] })
      if (method === 'POST') {
        const body = init?.body ? String(init.body) : ''
        if (body.includes('production reasoning health probe')) return jsonResponse({ choices: [{ message: { content: 'OK' } }] })
        nonProbeCalls += 1
        // First 2 calls (primary + the one allowed escalation) return content that trips the robotic
        // self-reference regex -- an unconditionally forbidden, non-overridable failure reason, so this
        // is guaranteed to reach the quality-gate-driven degrade branch, not the soft-pass path.
        if (nonProbeCalls <= 2) return jsonResponse({ choices: [{ message: { content: "As an AI, I can tell you the biggest risk is execution consistency across teams." } }] })
        return jsonResponse({ choices: [{ message: { content: 'The real answer: our biggest cultural risk is inconsistent execution standards across teams, not a lack of talent.' } }] })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    const result = await runCeoCognitiveLifecycle({ messages: [{ role: 'user', content: 'What do you think about our team culture?' }], timeoutMs: 30000 })
    expect(result.content).toContain('inconsistent execution standards')
    expect(result.content).not.toContain("I couldn't reliably complete that specific request")
    resetProviderHealthForTests()
  })

  // Adversarial-combination finding: this chain has never been exercised end to end before. Primary and
  // escalation both use mistral (the only provider governed for 'creative' among the two configured) and
  // both produce quality-failing robotic content, reaching the quality-gate-driven degrade branch (#114's
  // fix: a genuine recovery attempt is made, not skipped). attemptValidatedReasoningProvider validates
  // with the universal 'reasoning' taskType and finds groq first in provider order -- groq is healthy for
  // general reasoning but has NO governed model for 'creative'. So the recovery generation call itself
  // then hits the exact governance mismatch #115 fixed, inside the one path that fix's own tests never
  // reached (a recovery attempt, not a primary one). This proves the full chain still degrades cleanly to
  // the canned template -- no unhandled exception, no crash -- rather than merely trusting each fix's
  // isolated unit coverage to compose correctly under a combination neither fix's own tests constructed.
  // Live-production regression: pre-fix, attemptValidatedReasoningProvider validated with a hardcoded
  // taskType 'reasoning' regardless of the request's actual taskType, so it could hand back a provider
  // (e.g. groq) that recovery's real generation call -- using the request's real taskType -- was
  // structurally ungoverned to serve, guaranteeing a "no governed providers" throw with zero chance of a
  // real answer. When truly NO configured provider is governed for the request's taskType (unlike the
  // scenario below, where a governed provider exists but is temporarily failing), recovery should now
  // decline to probe at all (governedConfigured is empty) and degrade cleanly -- honestly, not via a
  // guaranteed-to-fail wasted attempt.
  test('when no configured provider is governed for the taskType at all, recovery declines cleanly with zero wasted attempts', async () => {
    resetProviderHealthForTests()
    // groq and cloudflare are both configured but neither has a governed model for 'creative'.
    process.env.GROQ_API_KEY = 'test-groq'
    process.env.CLOUDFLARE_API_TOKEN = 'test-cloudflare'
    process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account'
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); const method = String(init?.method ?? 'GET')
      if (method === 'POST') throw new Error(`no provider is governed for 'creative' -- no POST should ever be attempted: ${url}`)
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    const result = await runCeoCognitiveLifecycle({ taskType: 'creative', messages: [{ role: 'user', content: 'What do you think about our content strategy?' }], timeoutMs: 30000 })
    expect(result.degraded).toBe(true)
    expect(result.content).toContain("I couldn't reliably complete that specific request")
    resetProviderHealthForTests()
  })

  // The #117 mechanism, reproduced end to end for a genuinely creative-taskType request (explicit here
  // since inferTaskType no longer infers 'creative' from the bare word "content" -- see the TASK_HINTS
  // fix in canonical-llm-router.ts for why, and the next test for the actual live incident this exposed).
  // Primary generation correctly narrows to mistral (the only configured provider governed for
  // 'creative') and gets a real transient failure (429 rate limit) -- not a governance error. Pre-#117,
  // recovery's availability probe used taskType 'reasoning' and could validate a provider ungoverned for
  // 'creative', so it would guarantee-fail and degrade even though mistral itself was healthy again by
  // the time recovery ran. Post-#117, the probe validates against the real taskType, correctly
  // re-validates mistral, and the real recovery generation succeeds.
  test('a governed provider that failed transiently during primary generation is the one recovery validates and succeeds with -- not an ungoverned one', async () => {
    resetProviderHealthForTests()
    process.env.GROQ_API_KEY = 'test-groq'
    process.env.MISTRAL_API_KEY = 'test-mistral'
    let mistralGenerationCalls = 0
    let groqAttempted = false
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); const method = String(init?.method ?? 'GET')
      if (method === 'GET') {
        if (url.includes('api.groq.com')) return jsonResponse({ data: [{ id: 'llama-3.3-70b-versatile' }] })
        if (url.includes('api.mistral.ai')) return jsonResponse({ data: [{ id: 'mistral-large-latest' }] })
      }
      if (method === 'POST') {
        if (url.includes('api.groq.com')) { groqAttempted = true; throw new Error('groq is ungoverned for creative and must never be attempted, not even for recovery availability validation') }
        const body = init?.body ? String(init.body) : ''
        if (body.includes('production reasoning health probe')) return jsonResponse({ choices: [{ message: { content: 'OK' } }] })
        mistralGenerationCalls += 1
        // First real generation call is primary -- fails with a genuine transient rate limit, not a
        // governance error. Second is recovery's real generation -- succeeds with substantive content.
        if (mistralGenerationCalls === 1) return jsonResponse({ error: { message: 'rate limit exceeded' } }, 429)
        return jsonResponse({ choices: [{ message: { content: 'Write three headline options for the landing page, along with a one-line rationale for each so we can pick the strongest one.' } }] })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    const result = await runCeoCognitiveLifecycle({ taskType: 'creative', messages: [{ role: 'user', content: 'Write three headline options for the landing page.' }], timeoutMs: 30000 })
    expect(groqAttempted).toBe(false)
    expect(result.degraded).toBe(false)
    expect(result.provider).toBe('mistral')
    expect(result.content).not.toContain("I couldn't reliably complete that specific request")
    expect(result.content).toContain('headline')
    resetProviderHealthForTests()
  })

  // Live-production root cause: this exact message previously inferred taskType 'creative' purely from
  // the bare word "content" in "affiliate content" -- a business noun, not a request to write anything --
  // which confined an ordinary business-strategy question to the one taskType governed by only 2 of 5
  // providers. When both of those 2 happened to be genuinely down at once (a real, live incident: mistral
  // 429 rate-limited, openrouter failed UNKNOWN), the request had nowhere left to go and degraded to the
  // canned template -- not because #115/#117's fixes failed, but because the request was never supposed
  // to be confined to that fragile 2-provider lane in the first place. Locks in that it now correctly
  // falls through to 'reasoning' (governed by all 5 configured providers), so this exact question
  // survives losing any 2 providers simultaneously, not just recovers cleanly from a 2-of-2 outage.
  test('a business-strategy question that merely mentions "content" as a noun is no longer confined to the 2-provider creative lane', async () => {
    resetProviderHealthForTests()
    process.env.GROQ_API_KEY = 'test-groq'
    process.env.MISTRAL_API_KEY = 'test-mistral'
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); const method = String(init?.method ?? 'GET')
      if (method === 'GET') {
        if (url.includes('api.groq.com')) return jsonResponse({ data: [{ id: 'llama-3.3-70b-versatile' }] })
        if (url.includes('api.mistral.ai')) return jsonResponse({ data: [{ id: 'mistral-large-latest' }] })
      }
      if (method === 'POST') {
        // groq is ungoverned for 'creative' but IS governed for 'reasoning' -- reaching it here proves
        // this request is no longer restricted to the 2-provider creative lane.
        return jsonResponse({ choices: [{ message: { content: 'I recommend continuing affiliate content for now while funding a deliberate SaaS buildout in parallel, rather than switching all at once.' } }] })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    const result = await runCeoCognitiveLifecycle({ messages: [{ role: 'user', content: 'Weigh the tradeoffs between doubling down on affiliate content vs. building a SaaS product, and give me a recommendation.' }], timeoutMs: 30000 })
    expect(result.decisionPlan.taskClass).toBe('reasoning')
    expect(result.degraded).toBe(false)
    expect(result.content).not.toContain("I couldn't reliably complete that specific request")
    resetProviderHealthForTests()
  })

  // Deep-audit finding: semanticSubstanceCheck's own {substantive:true, checked:false} default on an
  // inconclusive verdict or an LLM error was, until this fix, passed straight through to
  // isGovernedSoftPassEligible as substantive:true -- silently granting the soft-pass protection the judge
  // exists to provide, exactly when the judge itself failed to run. This locks in that the judge's own
  // return value correctly distinguishes "positively confirmed substantive" from "unchecked", which is what
  // the ceo-cognitive-lifecycle.ts call site now requires (semanticCheck.checked && semanticCheck.substantive)
  // instead of trusting substantive alone -- mirroring the fail-closed contract semanticContinuityCheck
  // already established for the one other forbidden-failure override.
  test('semantic substance judge marks itself unchecked (not silently substantive) on an inconclusive verdict or a provider error', async () => {
    resetProviderHealthForTests()
    process.env.GROQ_API_KEY = 'test-groq'
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); const method = String(init?.method ?? 'GET')
      if (method === 'GET' && url.includes('api.groq.com')) return jsonResponse({ data: [{ id: 'llama-3.3-70b-versatile' }] })
      if (method === 'POST') return jsonResponse({ choices: [{ message: { content: 'I cannot determine that.' } }] })
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch
    const inconclusive = await semanticSubstanceCheck('What should we prioritize?', 'It depends on several factors.')
    expect(inconclusive.checked).toBe(false)
    expect(inconclusive.substantive).toBe(true)

    globalThis.fetch = (async () => { throw new Error('simulated network failure') }) as typeof fetch
    const errored = await semanticSubstanceCheck('What should we prioritize?', 'It depends on several factors.')
    expect(errored.checked).toBe(false)
    expect(errored.substantive).toBe(true)

    resetProviderHealthForTests()
  })

  // Deep-audit finding: semanticContinuityCheck previously received only request.priorConversation, denying
  // the one judge whose entire job is rescuing a genuinely coherent response the retrieved older history
  // (relevantOlderConversation) most likely to prove that coherence. Confirms the judge's outbound prompt
  // now actually includes older-conversation content when it is supplied, not just the six most recent turns.
  test('semantic continuity judge includes relevant older conversation in its prompt, not just recent turns', async () => {
    resetProviderHealthForTests()
    process.env.GROQ_API_KEY = 'test-groq'
    let capturedBody = ''
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); const method = String(init?.method ?? 'GET')
      if (method === 'GET' && url.includes('api.groq.com')) return jsonResponse({ data: [{ id: 'llama-3.3-70b-versatile' }] })
      if (method === 'POST') { capturedBody = init?.body ? String(init.body) : ''; return jsonResponse({ choices: [{ message: { content: 'COHERENT' } }] }) }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch
    const olderTurns = [{ role: 'user' as const, content: 'ARCHIVAL_MARKER_TOKEN_9F2 established the budget was fixed at $50k.', createdAt: Date.now() - 1_000_000 }]
    const recentTurns = [{ role: 'user' as const, content: 'Continue from where we left off.', createdAt: Date.now() }]
    await semanticContinuityCheck('What was the budget again?', recentTurns, 'The budget is $50k, as established earlier.', olderTurns)
    expect(capturedBody).toContain('ARCHIVAL_MARKER_TOKEN_9F2')
    resetProviderHealthForTests()
  })

  test('integration points use the cognitive lifecycle and preserve the ownership bridge', () => {
    const bridge = readFileSync('src/lib/agent-canonical-bridge.ts', 'utf8')
    const presenter = readFileSync('src/lib/ceo-presenter.ts', 'utf8')
    const missionRoute = readFileSync('src/app/api/mission-active/[missionId]/route.ts', 'utf8')
    const agentRoute = readFileSync('src/app/api/agent/route.ts', 'utf8')

    expect(bridge).toContain("runCeoCognitiveLifecycle")
    expect(bridge).toContain("getOrchestrationOwner")
    expect(bridge).toContain("if (owner === 'operational_orchestrator')")
    expect(bridge).toContain("runCanonicalLlm")

    expect(presenter).toContain("runCeoCognitiveLifecycle")
    expect(presenter).toContain("evaluateCeoDecision")
    expect(presenter).toContain("executeVerificationOfficerChallenge")

    expect(missionRoute).toContain("runCeoCognitiveLifecycle")
    expect(missionRoute).toContain("assertDelegationAllowed")
    expect(missionRoute).toContain("resolveMissionOwnerId")

    expect(agentRoute).toContain("runCeoCognitiveLifecycle")
    expect(agentRoute).toContain("preRouteCeoRequest")
    expect(agentRoute).toContain("withOrchestrationOwner")
    expect(agentRoute).toContain("runOrchestrator")
    expect(agentRoute).toContain("evidenceState: response.evidenceState")
  })
})
