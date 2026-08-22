import { describe, expect, test, afterEach } from 'bun:test'
import { MODEL_PROFILES, selectModelForTask } from './model-intelligence'

const ACTIVE = ['cerebras', 'gemini', 'groq', 'mistral', 'zai'] as const

afterEach(() => {
  delete process.env.GROQ_API_KEY
  delete process.env.ZAI_API_KEY
  delete process.env.MISTRAL_API_KEY
  delete process.env.GEMINI_API_KEY
  delete process.env.CEREBRAS_API_KEY
})

describe('Model Intelligence', () => {
  test('covers every canonical governed provider without retired OpenAI profiles', () => {
    const providers = [...new Set(MODEL_PROFILES.map((profile) => profile.provider))].sort()
    expect(providers).toEqual([...ACTIVE].sort())
    expect(MODEL_PROFILES.some((profile) => profile.provider === 'openai')).toBe(false)
  })

  test('prefers governed coding/tool-use models across configured providers', () => {
    process.env.GROQ_API_KEY = 'test'
    process.env.ZAI_API_KEY = 'test'
    process.env.MISTRAL_API_KEY = 'test'
    process.env.GEMINI_API_KEY = 'test'
    process.env.CEREBRAS_API_KEY = 'test'
    const selections = selectModelForTask('coding', ['groq', 'zai', 'mistral', 'gemini', 'cerebras'])
    expect(selections.length).toBeGreaterThanOrEqual(5)
    expect(selections.every((item) => item.rationale.includes('coding'))).toBe(true)
    expect(selections.some((item) => item.provider === 'groq')).toBe(true)
  })

  test('applies high-quality governed model preference for financial work', () => {
    process.env.GROQ_API_KEY = 'test'
    process.env.ZAI_API_KEY = 'test'
    process.env.MISTRAL_API_KEY = 'test'
    process.env.GEMINI_API_KEY = 'test'
    process.env.CEREBRAS_API_KEY = 'test'
    const selections = selectModelForTask('financial', ['groq', 'zai', 'mistral', 'gemini', 'cerebras'], 'dual-review')
    expect(selections.length).toBeGreaterThan(0)
    expect(selections[0]?.quality).toBeGreaterThanOrEqual(90)
  })
})
