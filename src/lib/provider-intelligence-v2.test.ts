import { describe, expect, test, afterEach } from 'bun:test'
import { getAllGovernanceProfiles, validateBuiltinGovernanceCoverage } from './subagent-governance'
import { PROVIDER_PRIORITY, getProviderTaskPolicy, rankAvailableProviders, validateProviderPriority } from './provider-intelligence-policy'
import { selectPrimaryProvider, selectProvidersForTask } from './provider-intelligence-v2'
import { PROVIDER_RUNTIME_CONFIG, getConfiguredProviders, getProviderRuntimeConfig, runGovernedProviderChat } from './provider-runtime-v2'
import { getModelForProvider } from './model-intelligence'
import { clearOutcomeIntelligenceForTests, getOutcomeSnapshot } from './outcome-intelligence'
import { SUBAGENTS } from './subagents'

afterEach(() => {
  clearOutcomeIntelligenceForTests()
  for (const env of ['GROQ_API_KEY', 'ZAI_API_KEY', 'MISTRAL_API_KEY', 'GEMINI_API_KEY', 'CEREBRAS_API_KEY']) delete process.env[env]
})

describe('Subagent Governance 2.0', () => {
  test('covers every built-in subagent exactly once', () => {
    expect(validateBuiltinGovernanceCoverage(SUBAGENTS)).toEqual([])
    expect(getAllGovernanceProfiles()).toHaveLength(SUBAGENTS.filter((agent) => agent.isBuiltin !== false).length)
  })

  test('uses exactly the canonical five-provider priority', () => {
    expect(PROVIDER_PRIORITY).toEqual(['groq', 'zai', 'mistral', 'gemini', 'cerebras'])
    expect(validateProviderPriority()).toEqual([])
  })

  test('ranks available providers in policy order without duplicating providers', () => {
    expect(rankAvailableProviders(['mistral', 'groq', 'groq'])).toEqual(['groq', 'mistral'])
  })

  test('requires stricter verification for financial and security tasks', () => {
    expect(getProviderTaskPolicy('financial').minVerification).toBe('dual-review')
    expect(getProviderTaskPolicy('security').minVerification).toBe('dual-review')
    expect(getProviderTaskPolicy('financial').requireIndependentVerification).toBe(true)
  })
})

describe('Provider Intelligence 2.0', () => {
  test('selects the highest-priority healthy provider', () => {
    expect(selectPrimaryProvider('financial', ['mistral', 'zai', 'groq'])?.provider).toBe('groq')
    expect(selectPrimaryProvider('general', ['zai', 'mistral'])?.provider).toBe('zai')
  })

  test('preserves fallback priority order', () => {
    expect(selectProvidersForTask('reasoning', ['mistral', 'zai', 'groq']).map((item) => item.provider))
      .toEqual(['groq', 'zai', 'mistral'])
  })

  test('has exactly one runtime descriptor for each governed provider', () => {
    expect(Object.keys(PROVIDER_RUNTIME_CONFIG).sort()).toEqual(['cerebras', 'gemini', 'groq', 'mistral', 'zai'])
    expect(PROVIDER_RUNTIME_CONFIG.groq.baseUrl).toBe('https://api.groq.com/openai/v1/chat/completions')
    expect(PROVIDER_RUNTIME_CONFIG.zai.baseUrl).toBe('https://api.z.ai/api/paas/v4/chat/completions')
    expect(PROVIDER_RUNTIME_CONFIG.mistral.baseUrl).toBe('https://api.mistral.ai/v1/chat/completions')
    expect(PROVIDER_RUNTIME_CONFIG.gemini.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')
    expect(PROVIDER_RUNTIME_CONFIG.cerebras.baseUrl).toBe('https://api.cerebras.ai/v1/chat/completions')
  })

  test('detects configured providers without changing canonical priority', () => {
    const original = { ...process.env }
    process.env.GROQ_API_KEY = 'test-groq'
    process.env.ZAI_API_KEY = 'test-zai'
    process.env.CEREBRAS_API_KEY = 'test-cerebras'
    delete process.env.MISTRAL_API_KEY
    delete process.env.GEMINI_API_KEY
    try {
      expect(getConfiguredProviders()).toEqual(['groq', 'zai', 'cerebras'])
      expect(getProviderRuntimeConfig('zai').defaultModel).toBe('glm-5.1')
    } finally {
      process.env = original
    }
  })

  test('selects task-aware governed models', () => {
    expect(getModelForProvider('groq', 'coding')).toBe('llama-3.3-70b-versatile')
    expect(getModelForProvider('zai', 'creative')).toBe('glm-5.1')
    expect(getModelForProvider('gemini', 'reasoning')).toBe('gemini-3.7-flash')
  })

  test('fails over in deterministic provider order while using task-aware models', async () => {
    const originalEnv = { ...process.env }
    const originalFetch = globalThis.fetch
    process.env.GROQ_API_KEY = 'test-groq'
    process.env.ZAI_API_KEY = 'test-zai'
    delete process.env.MISTRAL_API_KEY
    delete process.env.GEMINI_API_KEY
    delete process.env.CEREBRAS_API_KEY

    const calls: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push(`${url}::${String(init?.body ?? '')}`)
      if (url.includes('api.groq.com')) return new Response('temporary failure', { status: 503 })
      if (url.includes('api.z.ai')) return new Response(JSON.stringify({ choices: [{ message: { content: 'governed success' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    try {
      const result = await runGovernedProviderChat({ taskType: 'reasoning', messages: [{ role: 'user', content: 'test' }], timeoutMs: 5000 })
      expect(result.provider).toBe('zai')
      expect(result.model).toBe('glm-5.1')
      expect(result.attempts).toEqual(['groq', 'zai'])
      expect(calls[0]).toContain('https://api.groq.com/openai/v1/chat/completions')
      expect(calls[0]).toContain('llama-3.3-70b-versatile')
      expect(calls[1]).toContain('https://api.z.ai/api/paas/v4/chat/completions')
      expect(calls[1]).toContain('glm-5.1')
    } finally {
      globalThis.fetch = originalFetch
      process.env = originalEnv
    }
  })

  test('records verified outcome evidence only when the caller supplies it', async () => {
    const originalEnv = { ...process.env }
    const originalFetch = globalThis.fetch
    process.env.GROQ_API_KEY = 'test-groq'
    delete process.env.ZAI_API_KEY
    delete process.env.MISTRAL_API_KEY
    delete process.env.GEMINI_API_KEY
    delete process.env.CEREBRAS_API_KEY

    globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: 'verified result' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch

    try {
      await runGovernedProviderChat({ taskType: 'analysis', messages: [{ role: 'user', content: 'test' }], outcomeEvidence: { status: 'verified_success', qualityScore: 95, businessValueScore: 93, verificationPassed: true } })
      const snapshot = getOutcomeSnapshot('groq', 'llama-3.3-70b-versatile', 'analysis')
      expect(snapshot.observations).toBe(1)
      expect(snapshot.verifiedSuccesses).toBe(1)
      expect(snapshot.verificationRate).toBe(100)
      expect(snapshot.outcomeScore).toBeGreaterThanOrEqual(90)
    } finally {
      globalThis.fetch = originalFetch
      process.env = originalEnv
    }
  })
})
