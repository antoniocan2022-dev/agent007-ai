import { describe, expect, test } from 'bun:test'
import { classifyExecution } from '@/lib/adaptive-execution'

const user = (content: string) => [{ role: 'user', content }]

describe('Adaptive Execution Architecture', () => {
  test('routes greetings through the fast lane without deep orchestration', () => {
    const plan = classifyExecution(user('Hi!'))
    expect(plan.executionClass).toBe('fast')
    expect(plan.maxProviderAttempts).toBe(1)
    expect(plan.timeoutMs).toBe(8000)
    expect(plan.parallelizable).toBe(false)
  })

  test('keeps short informational questions fast', () => {
    const plan = classifyExecution(user('What is a database connection pool?'))
    expect(plan.executionClass).toBe('fast')
    expect(plan.maxTokens).toBe(1200)
  })

  test('preserves the deep path for complex research', () => {
    const plan = classifyExecution(user('Perform a comprehensive market research, compare competitors, verify evidence, analyze pricing and give a strategic recommendation.'))
    expect(['deep', 'mission']).toContain(plan.executionClass)
    expect(plan.maxProviderAttempts).toBe(4)
    expect(plan.maxTokens).toBe(8000)
    expect(plan.parallelizable).toBe(true)
  })

  test('uses the mission lane for governed external/business actions', () => {
    const plan = classifyExecution(user('Run the production deployment after verification and execute the governed mission.'))
    expect(plan.executionClass).toBe('mission')
    expect(plan.parallelizable).toBe(true)
  })

  test('classification uses the latest user request instead of the entire conversation history', () => {
    const plan = classifyExecution([
      { role: 'user', content: 'Perform a deep security audit of the entire system and compare the providers.' },
      { role: 'assistant', content: 'Understood.' },
      { role: 'user', content: 'Hi' },
    ])
    expect(plan.executionClass).toBe('fast')
  })
})
