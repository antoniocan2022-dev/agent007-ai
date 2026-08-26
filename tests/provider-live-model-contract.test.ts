import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { PROVIDER_ORDER, PROVIDER_RUNTIME_CONFIG, GOVERNED_MODEL_PROFILES } from '../src/lib/provider-control-plane'
import { getConfiguredProviders } from '../src/lib/provider-runtime-v2'

const EXPECTED_PROVIDERS = ['groq', 'cloudflare', 'mistral', 'cerebras', 'openrouter'] as const
const PROVIDER_ENV = ['GROQ_API_KEY', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'MISTRAL_API_KEY', 'CEREBRAS_API_KEY', 'OPENROUTER_API_KEY'] as const
const controlPlaneSource = readFileSync('src/lib/provider-control-plane.ts', 'utf8')
const runtimeSource = readFileSync('src/lib/provider-runtime-v2.ts', 'utf8')

describe('provider live-model contract', () => {
  it('keeps exactly five canonical governed providers and no OpenAI runtime entry', () => {
    expect(PROVIDER_ORDER).toEqual(EXPECTED_PROVIDERS)
    expect(Object.keys(PROVIDER_RUNTIME_CONFIG).sort()).toEqual([...EXPECTED_PROVIDERS].sort())
    expect((PROVIDER_RUNTIME_CONFIG as Record<string, unknown>).openai).toBeUndefined()
  })

  it('centralizes live catalog and Gemma 4 governance', () => {
    expect(PROVIDER_RUNTIME_CONFIG.groq.modelsUrl).toBe('https://api.groq.com/openai/v1/models')
    expect(PROVIDER_RUNTIME_CONFIG.cloudflare.modelsUrl).toContain('/accounts/{ACCOUNT_ID}/ai/models/search')
    expect(PROVIDER_RUNTIME_CONFIG.cloudflare.preferredModels[0]).toBe('@cf/google/gemma-4-26b-a4b-it')
    expect(PROVIDER_RUNTIME_CONFIG.mistral.modelsUrl).toBe('https://api.mistral.ai/v1/models')
    expect(PROVIDER_RUNTIME_CONFIG.cerebras.modelsUrl).toBe('https://api.cerebras.ai/v1/models')
    expect(PROVIDER_RUNTIME_CONFIG.openrouter.defaultModel).toBe('openrouter/free')
    expect(GOVERNED_MODEL_PROFILES.some((profile) => profile.provider === 'cloudflare' && profile.model === '@cf/google/gemma-4-26b-a4b-it' && profile.capabilities.includes('vision'))).toBe(true)
  })

  it('never invents provider configuration from missing environment variables', () => {
    const saved = Object.fromEntries(PROVIDER_ENV.map((env) => [env, process.env[env]])) as Record<string, string | undefined>
    try {
      for (const env of PROVIDER_ENV) delete process.env[env]
      expect(getConfiguredProviders()).toEqual([])
    } finally {
      for (const env of PROVIDER_ENV) { const value = saved[env]; if (value === undefined) delete process.env[env]; else process.env[env] = value }
    }
  })

  it('keeps live governance centralized and prevents duplicate runtime model matrices', () => {
    expect(controlPlaneSource).toContain('export const GOVERNED_MODEL_PROFILES')
    expect(runtimeSource).toContain('resolveGovernedModel')
    expect(runtimeSource).not.toContain('const PROVIDER_RUNTIME_CONFIG')
    expect(runtimeSource).not.toContain('interface ProviderRuntimeConfig')
    expect(runtimeSource).not.toContain('interface ModelCacheEntry')
  })
})
