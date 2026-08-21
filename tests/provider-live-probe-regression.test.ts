import { describe, expect, it } from 'bun:test'
import { PROVIDER_RUNTIME_CONFIG } from '../src/lib/provider-runtime-v2'

describe('provider live probe regression contract', () => {
  it('uses a sufficiently large probe budget for reasoning-capable Groq/Cerebras models', () => {
    expect(PROVIDER_RUNTIME_CONFIG.groq.preferredModels).toContain('openai/gpt-oss-120b')
    expect(PROVIDER_RUNTIME_CONFIG.cerebras.defaultModel).toBe('gpt-oss-120b')
  })

  it('pins Gemini to the current production model preference instead of stale 2.x models', () => {
    expect(PROVIDER_RUNTIME_CONFIG.gemini.defaultModel).toBe('gemini-3.6-flash')
    expect(PROVIDER_RUNTIME_CONFIG.gemini.preferredModels).toEqual(['gemini-3.6-flash'])
    expect(PROVIDER_RUNTIME_CONFIG.gemini.preferredModels).not.toContain('gemini-2.5-flash')
    expect(PROVIDER_RUNTIME_CONFIG.gemini.preferredModels).not.toContain('gemini-1.5-flash')
  })
})
