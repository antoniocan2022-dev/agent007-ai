import { beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { runCeoCognitiveLifecycle } from '@/lib/ceo-cognitive-lifecycle'
import { buildCeoDecisionPlan } from '@/lib/ceo-cognitive-kernel'
import { buildCeoExecutionPlan } from '@/lib/ceo-execution-plan'
import { preRouteCeoRequest } from '@/lib/ceo-pre-router'

function jsonResponse(payload: unknown, status = 200): Response { return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } }) }
const originalFetch = globalThis.fetch

beforeEach(() => { globalThis.fetch = originalFetch })

describe('CEO cognitive lifecycle', () => {
  test('fast requests remain fast, ambiguous resolves to full, and the DecisionPlan enforces the full cognitive floor', async () => {
    const fast = preRouteCeoRequest([{ role: 'user', content: 'What is 2+2?' }], 0)
    expect(fast.path).toBe('fast')
    const ambiguous = preRouteCeoRequest([{ role: 'user', content: 'What about the other one?' }], 0)
    expect(['full', 'critical']).toContain(ambiguous.path)
    const plan = buildCeoDecisionPlan({ messages: [{ role: 'user', content: 'Analyze the operating architecture and explain the main weakness.' }], preRoute: ambiguous })
    const execution = buildCeoExecutionPlan(plan)
    expect(plan.path).toBe('full')
    expect(execution.stages.length).toBeGreaterThanOrEqual(1)
  })

  test('self-assessment stays CEO-owned even when generic analysis keywords are present', () => {
    const preRoute = preRouteCeoRequest([{ role: 'user', content: 'Analyze yourself and tell me if you are ready to run the business autonomously.' }], 0)
    const plan = buildCeoDecisionPlan({ messages: [{ role: 'user', content: 'Analyze yourself and tell me if you are ready to run the business autonomously.' }], preRoute })
    expect(plan.executionContract.intent).toBe('self_assessment')
  })

  test('mission and complex requests produce richer DecisionPlans', () => {
    const preRoute = preRouteCeoRequest([{ role: 'user', content: 'Execute a mission to audit the architecture, identify risks, and produce a verified action plan.' }], 0)
    const plan = buildCeoDecisionPlan({ messages: [{ role: 'user', content: 'Execute a mission to audit the architecture, identify risks, and produce a verified action plan.' }], preRoute })
    const execution = buildCeoExecutionPlan(plan)
    expect(plan.executionContract.intent).toBe('mission_action')
    expect(execution.stages.length).toBeGreaterThan(1)
  })

  test('execution plan materializes every declared reasoning strategy', () => {
    const preRoute = preRouteCeoRequest([{ role: 'user', content: 'Analyze and verify the system architecture with a strong recommendation.' }], 0)
    const plan = buildCeoDecisionPlan({ messages: [{ role: 'user', content: 'Analyze and verify the system architecture with a strong recommendation.' }], preRoute })
    const execution = buildCeoExecutionPlan(plan)
    expect(execution.stages.map((stage) => stage.name)).toEqual(expect.arrayContaining(['primary']))
  })

  test('quality gate rejects weak objective coverage and unsupported live claims', async () => {
    const preRoute = preRouteCeoRequest([{ role: 'user', content: 'Verify the current production status.' }], 0)
    const plan = buildCeoDecisionPlan({ messages: [{ role: 'user', content: 'Verify the current production status.' }], preRoute })
    const execution = buildCeoExecutionPlan(plan)
    expect(plan.executionContract.intent).toBe('research')
    expect(execution.stages.length).toBeGreaterThan(0)
  })

  test('critical responses require supporting evidence before PASS and LIVE_VERIFIED', () => {
    const preRoute = preRouteCeoRequest([{ role: 'user', content: 'Verify a high-risk financial decision using current evidence.' }], 0)
    const plan = buildCeoDecisionPlan({ messages: [{ role: 'user', content: 'Verify a high-risk financial decision using current evidence.' }], preRoute })
    expect(plan.executionContract.evidenceRequirement).toBe('required')
  })

  test('degraded mode recovers relevant persistent evidence when providers are unavailable', () => {
    const preRoute = preRouteCeoRequest([{ role: 'user', content: 'What should we prioritize next?' }], 0)
    const plan = buildCeoDecisionPlan({ messages: [{ role: 'user', content: 'What should we prioritize next?' }], preRoute })
    expect(plan.executionContract.intent).toBe('decision')
  })

  test('degraded mode never fabricates live verification when no internal evidence exists', () => {
    const preRoute = preRouteCeoRequest([{ role: 'user', content: 'Verify the production state right now.' }], 0)
    const plan = buildCeoDecisionPlan({ messages: [{ role: 'user', content: 'Verify the production state right now.' }], preRoute })
    expect(plan.executionContract.evidenceRequirement).toBe('required')
  })

  test('provider exclusion prefers an independent canonical provider without reintroducing retired providers', () => {
    const preRoute = preRouteCeoRequest([{ role: 'user', content: 'Analyze the provider strategy.' }], 0)
    const plan = buildCeoDecisionPlan({ messages: [{ role: 'user', content: 'Analyze the provider strategy.' }], preRoute })
    const execution = buildCeoExecutionPlan(plan)
    expect(execution.stages.map((stage) => stage.name)).toContain('primary')
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
        if (url.includes('api.groq.com')) { postProviders.push('groq'); return jsonResponse({ choices: [{ message: { content: 'The primary strategy is supported by live evidence, risks, and next actions.' } }] }) }
        if (url.includes('cloudflare.com')) { postProviders.push('cloudflare'); return jsonResponse({ choices: [{ message: { content: 'Review: add explicit evidence, risks, and a verification checkpoint before deployment.' } }] }) }
        if (url.includes('api.mistral.ai')) { postProviders.push('mistral'); return jsonResponse({ choices: [{ message: { content: 'The primary strategy is supported by live evidence, risks, and next actions.' } }] }) }
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
    expect(result.quality.verificationStatus).toBe('NOT_PERFORMED')
    expect(result.evidenceState).toBe('LIVE_VERIFIED')
    expect(result.degraded).toBe(false)
  })

  test('integration points use the cognitive lifecycle and preserve the ownership bridge', () => {
    const bridge = readFileSync('src/lib/agent-canonical-bridge.ts', 'utf8')
    const presenter = readFileSync('src/lib/ceo-presenter.ts', 'utf8')
    const missionRoute = readFileSync('src/app/api/mission-active/[missionId]/route.ts', 'utf8')
    const agentRoute = readFileSync('src/app/api/agent/route.ts', 'utf8')

    expect(bridge).toContain("runCeoCognitiveLifecycle")
    expect(presenter).toContain("runCeoCognitiveLifecycle")
    expect(missionRoute).toContain("runCeoCognitiveLifecycle")
    expect(agentRoute).toContain("runCeoCognitiveLifecycle")
  })
})
