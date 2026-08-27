import { describe, expect, test, afterEach } from 'bun:test'
import { MODEL_PROFILES, selectModelForTask } from './model-intelligence'

const ACTIVE_PROVIDERS = ['groq', 'cloudflare', 'mistral', 'cerebras', 'openrouter'] as const

afterEach(() => {
  delete process.env.GROQ_API_KEY
  delete process.env.CLOUDFLARE_API_KEY
  delete process.env.CLOUDFLARE_ACCOUNT_ID
  delete process.env.MISTRAL_API_KEY
  delete process.env.CEREBRAS_API_KEY
  delete process.env.OPENROUTER_API_KEY
})

describe('Model Intelligence runtime contract', () => {
  test('all governed providers have task-aware models for their supported capabilities', () => {
    const providers = [...new Set(MODEL_PROFILES.map((profile) => profile.provider))]
    expect(providers.sort()).toEqual([...ACTIVE_PROVIDERS].sort())
    expect(providers).toHaveLength(ACTIVE_PROVIDERS.length)

    process.env.GROQ_API_KEY = 'test'
    process.env.CLOUDFLARE_API_KEY = 'test'
    process.env.CLOUDFLARE_ACCOUNT_ID = 'test'
    process.env.MISTRAL_API_KEY = 'test'
    process.env.CEREBRAS_API_KEY = 'test'
    process.env.OPENROUTER_API_KEY = 'test'

    for (const task of ['general', 'research', 'reasoning', 'coding', 'creative', 'financial', 'security', 'operations', 'analysis'] as const) {
      const selections = selectModelForTask(task, providers)
      expect(selections.length).toBeGreaterThan(0)
      expect(selections.every((selection) => providers.includes(selection.provider))).toBe(true)
    }
  })
})
