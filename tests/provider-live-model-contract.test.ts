import { describe, expect, it } from 'bun:test'
import { PROVIDER_RUNTIME_CONFIG, getConfiguredProviders } from '../src/lib/provider-runtime-v2'

const EXPECTED_PROVIDERS = ['groq', 'zai', 'mistral', 'gemini', 'cerebras'] as const

describe('provider live-model contract', () => {
  it('keeps exactly five governed providers and no OpenAI runtime entry', () => {
    expect(Object.keys(PROVIDER_RUNTIME_CONFIG).sort()).toEqual([...EXPECTED_PROVIDERS].sort())
    expect((PROVIDER_RUNTIME_CONFIG as Record<string, unknown>).openai).toBeUndefined()
  })

  it('defines model discovery for providers that expose OpenAI-compatible model catalogs', () => {
    expect(PROVIDER_RUNTIME_CONFIG.groq.modelsUrl).toBe('https://api.groq.com/openai/v1/models')
    expect(PROVIDER_RUNTIME_CONFIG.mistral.modelsUrl).toBe('https://api.mistral.ai/v1/models')
    expect(PROVIDER_RUNTIME_CONFIG.gemini.modelsUrl).toBe('https://generativelanguage.googleapis.com/v1beta/openai/models')
    expect(PROVIDER_RUNTIME_CONFIG.cerebras.modelsUrl).toBe('https://api.cerebras.ai/v1/models')
  })

  it('never invents provider configuration from missing environment variables', () => {
    const saved = {
      groq: process.env.GROQ_API_KEY,
      zai: process.env.ZAI_API_KEY,
      mistral: process.env.MISTRAL_API_KEY,
      gemini: process.env.GEMINI_API_KEY,
      cerebras: process.env.CEREBRAS_API_KEY,
    }

    for (const env of ['GROQ_API_KEY', 'ZAI_API_KEY', 'MISTRAL_API_KEY', 'GEMINI_API_KEY', 'CEREBRAS_API_KEY']) delete process.env[env]
    expect(getConfiguredProviders()).toEqual([])

    for (const [env, value] of Object.entries(saved)) {
      if (value !== undefined) process.env[env.toUpperCase() + '_API_KEY'.replace('_API_KEY_API_KEY', '_API_KEY')] = value
    }
  })
})
