import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { PROVIDER_RUNTIME_CONFIG, getConfiguredProviders } from '../src/lib/provider-runtime-v2'

const EXPECTED_PROVIDERS = ['groq', 'zai', 'mistral', 'gemini', 'cerebras'] as const
const PROVIDER_ENV = ['GROQ_API_KEY', 'ZAI_API_KEY', 'MISTRAL_API_KEY', 'GEMINI_API_KEY', 'CEREBRAS_API_KEY'] as const
const runtimeSource = readFileSync('src/lib/provider-runtime-v2.ts', 'utf8')

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
    const saved = Object.fromEntries(PROVIDER_ENV.map((env) => [env, process.env[env]])) as Record<string, string | undefined>
    try {
      for (const env of PROVIDER_ENV) delete process.env[env]
      expect(getConfiguredProviders()).toEqual([])
    } finally {
      for (const env of PROVIDER_ENV) {
        const value = saved[env]
        if (value === undefined) delete process.env[env]
        else process.env[env] = value
      }
    }
  })

  it('never lets mutable model env vars or arbitrary request models override the governed live model matrix', () => {
    expect(runtimeSource).not.toContain('if (configuredOverride && ids.includes(configuredOverride))')
    expect(runtimeSource).toContain('const governedCandidates = [governedPreferred, config.defaultModel')
    expect(runtimeSource).toContain('const requestedIsGoverned = !!requestedModel && governedCandidates.includes(requestedModel)')
    expect(runtimeSource).toContain('const model = await resolveAccessibleModel(provider, taskType, request.verification, request.model)')
    expect(runtimeSource).toContain('const candidateOrder = [requestedIsGoverned ? requestedModel! : undefined, ...governedCandidates]')
    expect(runtimeSource).not.toContain('const model = request.model || await resolveAccessibleModel')
    expect(runtimeSource).not.toContain('...ids]')
  })
})
