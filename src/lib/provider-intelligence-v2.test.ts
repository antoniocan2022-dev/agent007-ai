import { describe, expect, test } from 'bun:test'
import { getAllGovernanceProfiles, validateBuiltinGovernanceCoverage } from './subagent-governance'
import { PROVIDER_PRIORITY, getProviderTaskPolicy, rankAvailableProviders, validateProviderPriority } from './provider-intelligence-policy'
import { selectPrimaryProvider, selectProvidersForTask } from './provider-intelligence-v2'
import { PROVIDER_RUNTIME_CONFIG, getConfiguredProviders, getProviderRuntimeConfig } from './provider-runtime-v2'
import { SUBAGENTS } from './subagents'

describe('Subagent Governance 2.0', () => {
  test('covers every built-in subagent exactly once', () => {
    expect(validateBuiltinGovernanceCoverage(SUBAGENTS)).toEqual([])
    expect(getAllGovernanceProfiles()).toHaveLength(SUBAGENTS.filter((agent) => agent.isBuiltin !== false).length)
  })

  test('uses exactly the requested provider priority', () => {
    expect(PROVIDER_PRIORITY).toEqual(['groq', 'openai', 'zai', 'mistral'])
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
    expect(selectPrimaryProvider('financial', ['mistral', 'openai', 'groq'])?.provider).toBe('groq')
    expect(selectPrimaryProvider('general', ['zai', 'mistral'])?.provider).toBe('zai')
  })

  test('preserves fallback priority order', () => {
    expect(selectProvidersForTask('reasoning', ['mistral', 'zai', 'openai']).map((item) => item.provider))
      .toEqual(['openai', 'zai', 'mistral'])
  })

  test('has exactly one runtime descriptor for each governed provider', () => {
    expect(Object.keys(PROVIDER_RUNTIME_CONFIG).sort()).toEqual(['groq', 'mistral', 'openai', 'zai'])
    expect(PROVIDER_RUNTIME_CONFIG.groq.baseUrl).toBe('https://api.groq.com/openai/v1/chat/completions')
    expect(PROVIDER_RUNTIME_CONFIG.openai.baseUrl).toBe('https://api.openai.com/v1/chat/completions')
    expect(PROVIDER_RUNTIME_CONFIG.zai.baseUrl).toBe('https://api.z.ai/api/paas/v4/chat/completions')
    expect(PROVIDER_RUNTIME_CONFIG.mistral.baseUrl).toBe('https://api.mistral.ai/v1/chat/completions')
  })

  test('detects configured providers without changing priority', () => {
    const original = { ...process.env }
    process.env.GROQ_API_KEY = 'test-groq'
    process.env.OPENAI_API_KEY = 'test-openai'
    process.env.ZAI_API_KEY = 'test-zai'
    delete process.env.MISTRAL_API_KEY
    expect(getConfiguredProviders()).toEqual(['groq', 'openai', 'zai'])
    expect(getProviderRuntimeConfig('zai').defaultModel).toBe('glm-5.1')
    process.env = original
  })
})
