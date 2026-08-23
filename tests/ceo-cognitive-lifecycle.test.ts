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
  delete process.env.GROQ_API_KEY
  delete process.env.ZAI_API_KEY
  delete process.env.MISTRAL_API_KEY
  delete process.env.GEMINI_API_KEY
  delete process.env.CEREBRAS_API_KEY
})

describe('CEO cognitive lifecycle', () => {
  test('fast requests remain fast, ambiguous resolves to full, and the DecisionPlan enforces the full cognitive floor', () => {
    const fast = preRouteCeoRequest([{ role: 'user', content: 'What is compound interest?' }])
    expect(fast.route).toBe('fast')
    expect(fast.taskClass).toBe('reasoning')
    expect(fast.adaptiveExecutionClass).toBe('fast')
    const fastPlan = buildCeoDecisionPlan({ messages: [{ role: 'user', content: 'What is compound interest?' }], preRoute: fast })
    expect(fastPlan.path).toBe('fast')

    const ambiguousMessages = [
      'Continue this.',
      'What about the other one instead?',
      'Also, can you check that again?',
      'Can you help with that thing we discussed?',
    ]
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

  test('mission and complex requests produce richer DecisionPlans', () => {
    const preRoute = preRouteCeoRequest([{ role: 'user', content: 'Design a comprehensive strategy to launch Agent007 revenue operations in production.' }])
    const plan = buildCeoDecisionPlan({ messages: [{ role: 'user', content: 'Design a comprehensive strategy to launch Agent007 revenue operations in production.' }], preRoute, missionId: 'mission-1' })
    expect(plan.path).toBe('critical')
    expect(plan.reasoningStrategy).toBe('independent_review')
    expect(plan.cognitiveDepth).toBe(4)
    expect(plan.maxEscalations).toBe(2)
  })

  test('execution plan materializes every declared reasoning strategy', () => {
    const plans = [
      buildCeoExecutionPlan({
        requestId: 'fast', path: 'fast', objective: 'x', taskClass: 'reasoning', missionRelevant: false,
        requiredCapabilities: [], qualityTier: 'standard', reasoningStrategy: 'direct', cognitiveDepth: 0,
        verificationRequired: false, maxEscalations: 0, maxProviderAttempts: 1, latencyBudgetMs: 15000,
      }),
      buildCeoExecutionPlan({
        requestId: 'deep', path: 'full', objective: 'x', taskClass: 'research', missionRelevant: false,
        requiredCapabilities: ['research'], qualityTier: 'high', reasoningStrategy: 'multi_pass', cognitiveDepth: 2,
        verificationRequired: true, maxEscalations: 1, maxProviderAttempts: 4, latencyBudgetMs: 60000,
      }),
      buildCeoExecutionPlan({
        requestId: 'critical', path: 'critical', objective: 'x', taskClass: 'financial', missionRelevant: true,
        requiredCapabilities: ['verification'], qualityTier: 'critical', reasoningStrategy: 'independent_review', cognitiveDepth: 4,
        verificationRequired: true, maxEscalations: 2, maxProviderAttempts: 5, latencyBudgetMs: 90000,
      }),
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

  test('critical responses remain LIVE_EXECUTED unless actual supporting evidence is supplied', () => {
    const reviewed = evaluateCeoQuality({
      objective: 'Decide whether to deploy this mission and explain risks, evidence, and next actions.',
      content: '# Recommendation\n\nProceed only after independent review and explicit verification.\n\n- Evidence requirements\n- Risks\n- Next actions',
      path: 'critical',
      reviewed: true,
      externalExecutionSucceeded: true,
      evidenceProvided: false,
    })
    expect(reviewed.decision).toBe('PASS')
    expect(reviewed.evidenceState).toBe('LIVE_EXECUTED')
    expect(reviewed.verificationStatus).toBe('INDEPENDENT_PASS')

    const evidenced = evaluateCeoQuality({
      objective: 'Decide whether to deploy this mission and explain risks, evidence, and next actions.',
      content: '# Recommendation\n\nProceed only after independent review and explicit verification.\n\n- Evidence requirements\n- Risks\n- Next actions',
      path: 'critical',
      reviewed: true,
      externalExecutionSucceeded: true,
      evidenceProvided: true,
    })
    expect(evidenced.evidenceState).toBe('LIVE_VERIFIED')
  })

  test('degraded mode recovers relevant persistent evidence when providers are unavailable', async () => {
    const degraded = await buildCeoDegradedResponse({
      objective: 'What should Agent007 do about the current mission plan?',
      missionId: 'mission-42',
      reason: 'All approved external providers failed.',
      recall: async () => [
        { key: 'mission-42-priority', value: 'The mission priority is to preserve verified execution evidence before taking irreversible action.', category: 'mission', createdAt: Date.now(), score: 80, timesRecalled: 0 },
      ],
    })
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

  test('provider exclusion guarantees independent review does not reuse the primary provider', async () => {
    process.env.GROQ_API_KEY = 'test-groq'
    process.env.ZAI_API_KEY = 'test-zai'
    const calls: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = String(init?.method ?? 'GET')
      calls.push(`${url}::${method}`)
      if (url.includes('api.z.ai') && method === 'GET') return new Response(JSON.stringify({ data: [{ id: 'glm-5.1' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (url.includes('api.z.ai') && method === 'POST') return new Response(JSON.stringify({ choices: [{ message: { content: 'independent review response' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      throw new Error(`unexpected provider call: ${url}`)
    }) as typeof fetch

    const result = await runGovernedProviderChat({ taskType: 'reasoning', messages: [{ role: 'user', content: 'Review this draft.' }], excludeProviders: ['groq'], maxProviderAttempts: 1 })
    expect(result.provider).toBe('zai')
    expect(calls.some((call) => call.includes('groq.com'))).toBe(false)
  })

  test('critical lifecycle executes primary → independent review → synthesis with deterministic verification semantics', async () => {
    process.env.GROQ_API_KEY = 'test-groq'
    process.env.ZAI_API_KEY = 'test-zai'
    process.env.MISTRAL_API_KEY = 'test-mistral'
    const postProviders: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = String(init?.method ?? 'GET')
      if (method === 'GET') {
        if (url.includes('api.groq.com')) return new Response(JSON.stringify({ data: [{ id: 'llama-3.3-70b-versatile' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        if (url.includes('api.z.ai')) return new Response(JSON.stringify({ data: [{ id: 'glm-5.1' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        if (url.includes('api.mistral.ai')) return new Response(JSON.stringify({ data: [{ id: 'mistral-large-latest' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (method === 'POST') {
        if (url.includes('api.groq.com')) {
          postProviders.push('groq')
          return new Response(JSON.stringify({ choices: [{ message: { content: 'Agent007 should prioritize the proposed mission with evidence, risks, and next actions.' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
        if (url.includes('api.z.ai')) {
          postProviders.push('zai')
          return new Response(JSON.stringify({ choices: [{ message: { content: 'Review: the recommendation needs explicit evidence, risks, and a verification checkpoint.' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
        if (url.includes('api.mistral.ai')) {
          postProviders.push('mistral')
          return new Response(JSON.stringify({ choices: [{ message: { content: '# Recommendation\n\nAgent007 should prioritize the mission with explicit evidence and verification.\n\n- Evidence requirements\n- Risks\n- Next actions' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    const result = await runCeoCognitiveLifecycle({ missionId: 'mission-critical-test', messages: [{ role: 'user', content: 'Decide the best mission strategy for Agent007 and explain the evidence, risks, and next actions.' }], timeoutMs: 20000, contextualEvidence: 'Verified internal mission evidence is available for this controlled test.' })

    expect(postProviders).toEqual(['groq', 'zai', 'groq'])
    expect(result.executionPlan.stages.map((stage) => stage.name)).toEqual(['primary', 'independent_review', 'synthesis'])
    expect(result.quality.verificationStatus).toBe('INDEPENDENT_PASS')
    expect(result.evidenceState).toBe('LIVE_VERIFIED')
    expect(result.degraded).toBe(false)
  })

  test('integration points use the cognitive lifecycle and preserve compatibility metadata', () => {
    const bridge = readFileSync('src/lib/agent-canonical-bridge.ts', 'utf8')
    const presenter = readFileSync('src/lib/ceo-presenter.ts', 'utf8')
    const missionRoute = readFileSync('src/app/api/mission-active/[missionId]/route.ts', 'utf8')
    const agentRoute = readFileSync('src/app/api/agent/route.ts', 'utf8')
    expect(bridge).toContain("from './ceo-cognitive-lifecycle'")
    expect(bridge).not.toContain("from './canonical-llm-router'")
    expect(bridge).toContain('responseMs: result.responseMs')
    expect(bridge).toContain('getProviderTaskPolicy')
    expect(presenter).toContain("from './ceo-cognitive-lifecycle'")
    expect(presenter).toContain("const generationAuthorized = decisionKernel.decision === 'PROCEED'")
    expect(missionRoute).toContain('runCeoCognitiveLifecycle')
    expect(missionRoute).not.toContain("import('@/lib/agent')")
    expect(agentRoute).toContain('runCeoCognitiveLifecycle')
    expect(agentRoute).not.toContain('runCanonicalLlm')
    expect(agentRoute).toContain('preRouteCeoRequest')
  })
})
