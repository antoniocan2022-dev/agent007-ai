import { describe, expect, test, afterEach } from 'bun:test'
import { preRouteCeoRequest, resolvePreRoute } from '@/lib/ceo-pre-router'
import { buildCeoDecisionPlan } from '@/lib/ceo-cognitive-kernel'
import { buildCeoExecutionPlan } from '@/lib/ceo-execution-plan'
import { evaluateCeoQuality } from '@/lib/ceo-quality-gate'
import { buildCeoDegradedResponse } from '@/lib/ceo-degraded-mode'
import { runGovernedProviderChat } from '@/lib/provider-runtime-v2'
import { readFileSync } from 'node:fs'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  delete process.env.GROQ_API_KEY
  delete process.env.ZAI_API_KEY
})

describe('CEO cognitive lifecycle', () => {
  test('fast requests remain fast and ambiguous defaults to full', () => {
    const fast = preRouteCeoRequest([{ role: 'user', content: 'What is compound interest?' }])
    expect(fast.route).toBe('fast')

    const ambiguous = preRouteCeoRequest([{ role: 'user', content: 'Continue this.' }])
    expect(ambiguous.route).toBe('ambiguous')
    expect(resolvePreRoute(ambiguous)).toBe('full')
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

  test('fast path uses lightweight quality checks while critical path requires review', () => {
    const fast = evaluateCeoQuality({ objective: 'What is compound interest?', content: 'Compound interest is interest earned on principal plus accumulated interest.', path: 'fast', reviewed: false, externalExecutionSucceeded: true })
    expect(fast.decision).toBe('PASS')
    expect(fast.evidenceState).toBe('LIVE_VERIFIED')

    const critical = evaluateCeoQuality({ objective: 'Decide whether to deploy this mission.', content: 'A draft recommendation without independent review.', path: 'critical', reviewed: false, externalExecutionSucceeded: true })
    expect(critical.decision).toBe('ESCALATE')
    expect(critical.reasons.some((reason) => reason.includes('independent review'))).toBe(true)
  })

  test('degraded mode never fabricates live verification', () => {
    const degraded = buildCeoDegradedResponse({ objective: 'What is the current market?', reason: 'All approved external providers failed.' })
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

    const result = await runGovernedProviderChat({
      taskType: 'reasoning',
      messages: [{ role: 'user', content: 'Review this draft.' }],
      excludeProviders: ['groq'],
      maxProviderAttempts: 1,
    })
    expect(result.provider).toBe('zai')
    expect(calls.some((call) => call.includes('groq.com'))).toBe(false)
  })

  test('integration points use the cognitive lifecycle and preserve compatibility metadata', () => {
    const bridge = readFileSync('src/lib/agent-canonical-bridge.ts', 'utf8')
    const presenter = readFileSync('src/lib/ceo-presenter.ts', 'utf8')
    expect(bridge).toContain("from './ceo-cognitive-lifecycle'")
    expect(bridge).not.toContain("from './canonical-llm-router'")
    expect(bridge).toContain('responseMs: result.responseMs')
    expect(bridge).toContain('getProviderTaskPolicy')
    expect(presenter).toContain("from './ceo-cognitive-lifecycle'")
  })
})
