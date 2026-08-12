import { describe, expect, test } from 'bun:test'
import { getAllGovernanceProfiles, validateBuiltinGovernanceCoverage } from './subagent-governance'
import { PROVIDER_PRIORITY, getProviderTaskPolicy, rankAvailableProviders, validateProviderPriority } from './provider-intelligence-policy'
import { selectPrimaryProvider, selectProvidersForTask } from './provider-intelligence-v2'
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
})
