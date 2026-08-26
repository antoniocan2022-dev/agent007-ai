import { describe, expect, it } from 'bun:test'
import { PROVIDER_PRIORITY, validateProviderPriority } from '@/lib/provider-intelligence-policy'
import { PROVIDER_RUNTIME_CONFIG } from '@/lib/provider-runtime-v2'
import { getProviderMetadataSummary } from '@/lib/provider-intelligence'
import { MODEL_PROFILES } from '@/lib/model-intelligence'

const ACTIVE = ['groq', 'cloudflare', 'mistral', 'cerebras', 'openrouter'] as const

describe('canonical provider selection', () => {
  it('uses exactly the canonical five active providers in order', () => {
    expect(PROVIDER_PRIORITY).toEqual(ACTIVE)
    expect(validateProviderPriority()).toEqual([])
  })

  it('does not expose retired or OpenAI providers as active runtime entries', () => {
    expect(Object.keys(PROVIDER_RUNTIME_CONFIG).sort()).toEqual([...ACTIVE].sort())
    expect('openai' in PROVIDER_RUNTIME_CONFIG).toBe(false)
    expect('zai' in PROVIDER_RUNTIME_CONFIG).toBe(false)
    expect('gemini' in PROVIDER_RUNTIME_CONFIG).toBe(false)
    expect(MODEL_PROFILES.some((profile) => profile.provider === 'openai')).toBe(false)
    expect(MODEL_PROFILES.some((profile) => profile.provider === 'zai')).toBe(false)
    expect(MODEL_PROFILES.some((profile) => profile.provider === 'gemini')).toBe(false)
  })

  it('uses canonical provider endpoints and models', () => {
    expect(PROVIDER_RUNTIME_CONFIG.groq.baseUrl).toContain('api.groq.com')
    expect(PROVIDER_RUNTIME_CONFIG.cloudflare.baseUrl).toContain('api.cloudflare.com')
    expect(PROVIDER_RUNTIME_CONFIG.mistral.baseUrl).toContain('api.mistral.ai')
    expect(PROVIDER_RUNTIME_CONFIG.cerebras.baseUrl).toContain('api.cerebras.ai')
    expect(PROVIDER_RUNTIME_CONFIG.openrouter.baseUrl).toContain('openrouter.ai')
    expect(PROVIDER_RUNTIME_CONFIG.cloudflare.defaultModel).toBe('@cf/google/gemma-4-26b-a4b-it')
    expect(PROVIDER_RUNTIME_CONFIG.openrouter.defaultModel).toBe('openrouter/free')
    expect(PROVIDER_RUNTIME_CONFIG.cerebras.defaultModel).toBe('gpt-oss-120b')
  })

  it('does not advertise retired providers through provider intelligence', () => {
    const summary = getProviderMetadataSummary().toLowerCase()
    expect(summary).toContain('groq')
    expect(summary).toContain('cloudflare')
    expect(summary).toContain('mistral')
    expect(summary).toContain('cerebras')
    expect(summary).toContain('openrouter')
    expect(summary).not.toContain('z.ai')
    expect(summary).not.toContain('zai')
    expect(summary).not.toContain('gemini')
    expect(summary).not.toContain('openai')
  })
})
