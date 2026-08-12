import { describe, expect, test } from 'bun:test'
import { MODEL_PROFILES, selectModelForTask } from './model-intelligence'

describe('Model Intelligence', () => {
  test('defines one canonical profile per governed provider', () => {
    expect(MODEL_PROFILES.map((profile) => profile.provider).sort()).toEqual(['groq', 'mistral', 'openai', 'zai'])
  })

  test('prefers strong coding/tool-use fit for coding tasks', () => {
    process.env.GROQ_API_KEY = 'test'
    process.env.OPENAI_API_KEY = 'test'
    process.env.ZAI_API_KEY = 'test'
    process.env.MISTRAL_API_KEY = 'test'
    const selections = selectModelForTask('coding', ['groq', 'openai', 'zai', 'mistral'])
    expect(selections.length).toBe(4)
    expect(selections.every((item) => item.rationale.includes('coding'))).toBe(true)
  })

  test('applies stricter quality preference for financial work', () => {
    process.env.GROQ_API_KEY = 'test'
    process.env.OPENAI_API_KEY = 'test'
    process.env.ZAI_API_KEY = 'test'
    process.env.MISTRAL_API_KEY = 'test'
    const selections = selectModelForTask('financial', ['groq', 'openai', 'zai', 'mistral'], 'dual-review')
    expect(selections[0]?.quality).toBeGreaterThanOrEqual(90)
    expect(selections[0]?.rationale).toContain('strict-risk quality bonus')
  })
})
