import { afterEach, describe, expect, test } from 'bun:test'
import { classifyProviderErrorLifecycle, recordProviderError, recordProviderSuccess, resetProviderErrorLifecycle } from '@/lib/provider-error-lifecycle'

afterEach(() => resetProviderErrorLifecycle())

describe('provider error lifecycle', () => {
  test('classifies a new error as active', () => {
    const now = 1_000_000
    recordProviderError('groq', 'UPSTREAM', now)
    expect(classifyProviderErrorLifecycle('groq', 'UPSTREAM', now + 1).state).toBe('active')
  })

  test('classifies repeated recent errors as recurring', () => {
    const now = 2_000_000
    recordProviderError('cloudflare', 'TIMEOUT', now - 5_000)
    recordProviderError('cloudflare', 'TIMEOUT', now - 4_000)
    recordProviderError('cloudflare', 'TIMEOUT', now - 3_000)
    expect(classifyProviderErrorLifecycle('cloudflare', 'TIMEOUT', now).state).toBe('recurring')
  })

  test('classifies old unresolved errors as historical', () => {
    const now = 3_000_000
    recordProviderError('mistral', 'NETWORK', now - 25 * 60 * 60 * 1000)
    expect(classifyProviderErrorLifecycle('mistral', 'NETWORK', now).state).toBe('historical')
  })

  test('classifies an error as resolved after a later successful execution', () => {
    const now = 4_000_000
    recordProviderError('cerebras', 'UPSTREAM', now - 10_000)
    recordProviderSuccess('cerebras', now - 1_000)
    expect(classifyProviderErrorLifecycle('cerebras', 'UPSTREAM', now).state).toBe('resolved')
  })
})
