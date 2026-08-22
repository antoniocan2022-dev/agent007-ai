import { describe, expect, it } from 'bun:test'
import { PROVIDER_PRIORITY, validateProviderPriority } from '@/lib/provider-intelligence-policy'
import { PROVIDER_RUNTIME_CONFIG } from '@/lib/provider-runtime-v2'
import { getProviderMetadataSummary } from '@/lib/provider-intelligence'
import { MODEL_PROFILES } from '@/lib/model-intelligence'

const ACTIVE = ['groq', 'zai', 'mistral', 'gemini', 'cerebras'] as const

describe('canonical provider selection', () => {
  it('uses exactly the requested five active providers in order', () => {
    expect(PROVIDER_PRIORITY).toEqual(ACTIVE)
    expect(validateProviderPriority()).toEqual([])
  })

  it('does not expose OpenAI as an active runtime or model profile', () => {
    expect(Object.keys(PROVIDER_RUNTIME_CONFIG).sort()).toEqual([...ACTIVE].sort())
    expect('openai' in PROVIDER_RUNTIME_CONFIG).toBe(false)
    expect(MODEL_PROFILES.some((profile) => profile.provider === 'openai')).toBe(false)
  })

  it('uses canonical provider endpoints and models', () => {
    expect(PROVIDER_RUNTIME_CONFIG.groq.baseUrl).toContain('api.groq.com')
    expect(PROVIDER_RUNTIME_CONFIG.zai.baseUrl).toContain('api.z.ai')
    expect(PROVIDER_RUNTIME_CONFIG.mistral.baseUrl).toContain('api.mistral.ai')
    expect(PROVIDER_RUNTIME_CONFIG.gemini.baseUrl).toContain('generativelanguage.googleapis.com')
    expect(PROVIDER_RUNTIME_CONFIG.cerebras.baseUrl).toContain('api.cerebras.ai')
    expect(PROVIDER_RUNTIME_CONFIG.gemini.defaultModel).toBe('gemini-3.7-flash')
    expect(PROVIDER_RUNTIME_CONFIG.cerebras.defaultModel).toBe('gpt-oss-120b')
  })

  it('does not advertise retired providers through provider intelligence', () => {
    const summary = getProviderMetadataSummary().toLowerCase()
    expect(summary).toContain('groq')
    expect(summary).toContain('z.ai')
    expect(summary).toContain('mistral')
    expect(summary).toContain('gemini')
    expect(summary).toContain('cerebras')
    expect(summary).not.toContain('openai')
    expect(summary).not.toContain('openrouter')
  })
})
