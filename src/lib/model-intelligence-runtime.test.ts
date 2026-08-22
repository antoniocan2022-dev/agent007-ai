import { describe, expect, test } from 'bun:test'
import { MODEL_PROFILES, selectModelForTask } from './model-intelligence'

describe('Model Intelligence runtime contract', () => {
  test('all five governed providers have task-aware models for their supported capabilities', () => {
    const providers = [...new Set(MODEL_PROFILES.map((profile) => profile.provider))]
    expect(providers).toEqual(expect.arrayContaining(['groq', 'zai', 'mistral', 'gemini', 'cerebras']))
    expect(providers).toHaveLength(5)
    process.env.GROQ_API_KEY = 'test'
    process.env.ZAI_API_KEY = 'test'
    process.env.MISTRAL_API_KEY = 'test'
    process.env.GEMINI_API_KEY = 'test'
    process.env.CEREBRAS_API_KEY = 'test'
    for (const task of ['general', 'research', 'reasoning', 'coding', 'creative', 'financial', 'security', 'operations', 'analysis'] as const) {
      const selections = selectModelForTask(task, providers)
      expect(selections.length).toBeGreaterThan(0)
      expect(selections.every((selection) => providers.includes(selection.provider))).toBe(true)
    }
  })

  test('Gemini 3.7 Flash is the primary governed Gemini model', () => {
    const gemini = MODEL_PROFILES.filter((profile) => profile.provider === 'gemini')
    expect(gemini[0]?.model).toBe('gemini-3.7-flash')
    expect(gemini.map((profile) => profile.model)).toContain('gemini-3.6-flash')
  })
})
