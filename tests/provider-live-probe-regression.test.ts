import { describe, expect, it } from 'bun:test'
import { PROVIDER_ORDER, PROVIDER_RUNTIME_CONFIG } from '../src/lib/provider-control-plane'

describe('provider live probe regression contract', () => {
  it('uses the replacement provider order and neutral reasoning probe', () => {
    expect(PROVIDER_ORDER).toEqual(['groq', 'cloudflare', 'mistral', 'cerebras', 'openrouter'])
    expect(PROVIDER_RUNTIME_CONFIG.cloudflare.defaultModel).toBe('@cf/google/gemma-4-26b-a4b-it')
    expect(PROVIDER_RUNTIME_CONFIG.openrouter.defaultModel).toBe('openrouter/free')
  })

  it('contains no retired Z.AI or Gemini runtime configuration', () => {
    expect(Object.keys(PROVIDER_RUNTIME_CONFIG)).not.toContain('zai')
    expect(Object.keys(PROVIDER_RUNTIME_CONFIG)).not.toContain('gemini')
  })
})
