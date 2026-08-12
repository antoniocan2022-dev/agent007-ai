import { describe, expect, test } from 'bun:test'
import { MODEL_PROFILES, selectModelForTask } from './model-intelligence'

describe('Model Intelligence runtime contract', () => {
  test('all governed providers have a task-aware model', () => {
    const providers = MODEL_PROFILES.map((profile) => profile.provider)
    expect(new Set(providers).size).toBe(4)
    for (const task of ['general', 'research', 'reasoning', 'coding', 'creative', 'financial', 'security', 'operations', 'analysis'] as const) {
      process.env.GROQ_API_KEY = 'test'
      process.env.OPENAI_API_KEY = 'test'
      process.env.ZAI_API_KEY = 'test'
      process.env.MISTRAL_API_KEY = 'test'
      expect(selectModelForTask(task, providers).length).toBe(4)
    }
  })
})
