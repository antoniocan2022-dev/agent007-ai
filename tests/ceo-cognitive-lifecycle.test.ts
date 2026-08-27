import { describe, expect, test, afterEach } from 'bun:test'
import { preRouteCeoRequest, resolvePreRoute } from '@/lib/ceo-pre-router'
import { buildCeoDecisionPlan } from '@/lib/ceo-cognitive-kernel'
import { buildCeoExecutionPlan } from '@/lib/ceo-execution-plan'
import { evaluateCeoQuality } from '@/lib/ceo-response-quality-gate'
import { buildCeoDegradedResponse } from '@/lib/ceo-degraded-mode'
import { runGovernedProviderChat } from '@/lib/provider-runtime-v2'
import { runCeoCognitiveLifecycle } from '@/lib/ceo-cognitive-lifecycle'
import { readFileSync } from 'node:fs'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  for (const key of ['GROQ_API_KEY', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'MISTRAL_API_KEY', 'CEREBRAS_API_KEY', 'OPENROUTER_API_KEY']) delete process.env[key]
})

const criticalAnswer = `# Recommendation\n\nDecision: proceed only after independent review and explicit verification of the deployment evidence. The recommended action is to advance the mission only when the evidence package is complete, the identified risks are understood, and the execution conditions are satisfied.\n\n## Evidence\n- Confirm the deployment identity and verify the exact release evidence before execution.\n- Confirm the independent review result and reconcile any material disagreement.\n- Preserve the supporting mission evidence so the decision remains auditable.\n\n## Risks\n- Deployment without complete evidence could create an irreversible production error.\n- Conflicting verification results require escalation rather than silent selection.\n- Missing current evidence means the system must not claim live confirmation.\n\n## Next Actions\n1. Complete the independent verification checkpoint.\n2. Record the final evidence and decision state.\n3. Proceed only when all mandatory gates are satisfied.`

function jsonResponse(payload: unknown, status = 200): Response { return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } }) }

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
    const plans = [
      buildCeoExecutionPlan({ requestId: 'fast', path: 'fast', objective: 'x', taskClass: 'reasoning', missionRelevant: false, requiredCapabilities: [], qualityTier: 'standard', reasoningStrategy: 'direct', cognitiveDepth: 0, verificationRequired: false, maxEscalations: 0, maxProviderAttempts: 1, latencyBudgetMs: 15000 }),
      buildCeoExecutionPlan({ requestId: 'deep', path: 'full', objective: 'x', taskClass: 'research', missionRelevant: false, requiredCapabilities: ['research'], qualityTier: 'high', reasoningStrategy: 'multi_pass', cognitiveDepth: 2, verificationRequired: true, maxEscalations: 1, maxProviderAttempts: 4, latencyBudgetMs: 60000 }),
      buildCeoExecutionPlan({ requestId: 'critical', path: 'critical', objective: 'x', taskClass: 'financial', missionRelevant: true, requiredCapabilities: ['verification'], qualityTier: 'critical', reasoningStrategy: 'independent_review', cognitiveDepth: 4, verificationRequired: true, maxEscalations: 2, maxProviderAttempts: 5, latencyBudgetMs: 90000 }),
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
    const evidenced = evaluateCeoQuality({ objective: 'Decide whether to deploy this mission and explain risks, evidence, and next actions.', content: criticalAnswer, path: 'critical', reviewed: true, externalExecutionSucceeded: true, evidenceProvided: true })
    expect(evidenced.decision).toBe('PASS')
    expect(evidenced.evidenceState).toBe('LIVE_VERIFIED')
    expect(evidenced.verificationStatus).toBe('INDEPENDENT_PASS')
  })

  test('degraded mode recovers relevant persistent evidence when providers are unavailable', async () => {
    const degraded = await buildCeoDegradedResponse({ objective: 'What should Agent007 do about the current mission plan?', missionId: 'mission-42', reason: 'All approved external providers failed.', recall: async () => [{ key: 'mission-42-priority', value: 'The mission priority is to preserve verified execution evidence before taking irreversible action.', category: 'mission', createdAt: Date.now(), score: 80, timesRecalled: 0 }] })
    expect(degraded.evidenceState).toBe('MEMORY_ONLY')
    expect(degraded.sourceKeys).toEqual(['mission-42-priority'])
    expect(degraded.content).toContain('MEMORY-ONLY')
    expect(degraded.content).toContain('preserve verified execution evidence')
  })

  test('degraded mode never fabricates live verification when no internal evidence exists', async () => {
    const degraded = await buildCeoDegradedResponse({ objective: 'What is the current market?', reason: 'All approved external providers failed.', recall: async () => [] })
    expect(degraded.evidenceState).toBe('UNAVAILABLE')
    expect(degraded.content).toContain('will not fabricate a live or verified answer')
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
    const result = await runCeoCognitiveLifecycle({ missionId: 'mission-critical-test', messages: [{ role: 'user', content: 'Decide the best mission strategy for Agent007 and explain the evidence, risks, and next actions.' }], timeoutMs: 30000, contextualEvidence: 'Verified internal mission evidence is available for this controlled test.' })
    const canonical = new Set(['groq', 'cloudflare', 'mistral', 'cerebras', 'openrouter'])
    expect(postProviders.length).toBeGreaterThanOrEqual(3)
    expect(postProviders.every((provider) => canonical.has(provider))).toBe(true)
    expect(new Set(postProviders).size).toBeGreaterThanOrEqual(2)
    expect(result.executionPlan.stages.map((stage) => stage.name)).toEqual(['primary', 'independent_review', 'synthesis'])
    expect(result.quality.verificationStatus).toBe('INDEPENDENT_PASS')
    expect(result.evidenceState).toBe('LIVE_VERIFIED')
    expect(result.degraded).toBe(false)
  })

  test('integration points use the cognitive lifecycle and preserve the ownership bridge', () => {
    const bridge = readFileSync('src/lib/agent-canonical-bridge.ts', 'utf8')
    const presenter = readFileSync('src/lib/ceo-presenter.ts', 'utf8')
    const missionRoute = readFileSync('src/app/api/mission-active/[missionId]/route.ts', 'utf8')
    const agentRoute = readFileSync('src/app/api/agent/route.ts', 'utf8')
    expect(bridge).toContain("from './ceo-cognitive-lifecycle'")
    expect(bridge).toContain("from './canonical-llm-router'")
    expect(bridge).toContain("from './ceo-execution-owner'")
    expect(bridge).toContain("owner === 'operational_orchestrator'")
    expect(bridge).toContain('runCanonicalLlm({')
    expect(bridge).toContain('responseMs: result.responseMs')
    expect(bridge).toContain('getProviderTaskPolicy')
    expect(presenter).toContain("from './ceo-cognitive-lifecycle'")
    expect(presenter).toContain("const generationAuthorized = decisionKernel.decision === 'PROCEED'")
    expect(missionRoute).toContain('runCeoCognitiveLifecycle')
    expect(missionRoute).not.toContain("import('@/lib/agent')")
    expect(agentRoute).toContain('runCeoCognitiveLifecycle')
    expect(agentRoute).toContain('withOrchestrationOwner')
    expect(agentRoute).toContain('RecoveryBudget')
    expect(agentRoute).not.toContain('runCanonicalLlm')
    expect(agentRoute).toContain('preRouteCeoRequest')
  })
})
