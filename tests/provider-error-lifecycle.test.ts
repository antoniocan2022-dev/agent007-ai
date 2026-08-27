import { afterEach, describe, expect, test } from 'bun:test'
import { classifyProviderErrorLifecycle, recordProviderError, recordProviderSuccess, resetProviderErrorLifecycle } from '@/lib/provider-error-lifecycle'

afterEach(() => resetProviderErrorLifecycle())

// Keep the logical test clock well outside the live runtime's current window so
// concurrent suites cannot contaminate recentErrorCount for these assertions.
const TEST_NOW = Date.now() + 48 * 60 * 60 * 1000

describe('provider error lifecycle', () => {
  test('classifies a new error as active', () => {
    recordProviderError('groq', 'UPSTREAM', TEST_NOW)
    expect(classifyProviderErrorLifecycle('groq', 'UPSTREAM', TEST_NOW + 1).state).toBe('active')
  })

  test('classifies repeated recent errors as recurring', () => {
    recordProviderError('cloudflare', 'TIMEOUT', TEST_NOW - 5_000)
    recordProviderError('cloudflare', 'TIMEOUT', TEST_NOW - 4_000)
    recordProviderError('cloudflare', 'TIMEOUT', TEST_NOW - 3_000)
    expect(classifyProviderErrorLifecycle('cloudflare', 'TIMEOUT', TEST_NOW).state).toBe('recurring')
  })

  test('classifies old unresolved errors as historical', () => {
    recordProviderError('mistral', 'NETWORK', TEST_NOW - 25 * 60 * 60 * 1000)
    expect(classifyProviderErrorLifecycle('mistral', 'NETWORK', TEST_NOW).state).toBe('historical')
  })

  test('classifies an error as resolved after a later successful execution', () => {
    recordProviderError('cerebras', 'UPSTREAM', TEST_NOW - 10_000)
    recordProviderSuccess('cerebras', TEST_NOW - 1_000)
    expect(classifyProviderErrorLifecycle('cerebras', 'UPSTREAM', TEST_NOW).state).toBe('resolved')
  })
})