import { beforeEach, describe, expect, test } from 'bun:test'
import { getPerformanceSnapshot, recommendModelsForTask, recordModelPerformance } from './performance-intelligence'
import { rankAvailableProviders } from './provider-intelligence-policy'

beforeEach(() => {
  const G = globalThis as any
  G.__agent007Performance = new Map()
})

describe('Performance Intelligence', () => {
  test('starts from governed model priors during cold start', () => {
    const recommendations = recommendModelsForTask('coding', ['groq', 'openai'])
    expect(recommendations.length).toBe(2)
    expect(recommendations.every((item) => item.calls === 0)).toBe(true)
    expect(recommendations.every((item) => item.confidence === 25)).toBe(true)
  })

  test('learns success rate and latency from runtime observations', () => {
    recordModelPerformance({ provider: 'groq', model: 'llama-3.3-70b-versatile', taskType: 'coding', success: true, responseMs: 400 })
    recordModelPerformance({ provider: 'groq', model: 'llama-3.3-70b-versatile', taskType: 'coding', success: true, responseMs: 600 })
    recordModelPerformance({ provider: 'groq', model: 'llama-3.3-70b-versatile', taskType: 'coding', success: false, responseMs: 1000 })
    const snapshot = getPerformanceSnapshot('groq', 'llama-3.3-70b-versatile', 'coding')
    expect(snapshot.calls).toBe(3)
    expect(snapshot.successes).toBe(2)
    expect(snapshot.failures).toBe(1)
    expect(snapshot.successRate).toBe(67)
    expect(snapshot.avgResponseMs).toBe(667)
  })

  test('keeps learned recommendations advisory to provider governance', () => {
    recordModelPerformance({ provider: 'mistral', model: 'mistral-large-latest', taskType: 'reasoning', success: true, responseMs: 100 })
    recordModelPerformance({ provider: 'groq', model: 'llama-3.3-70b-versatile', taskType: 'reasoning', success: false, responseMs: 10000 })
    const recommendations = recommendModelsForTask('reasoning', ['groq', 'mistral'])
    expect(recommendations.length).toBe(2)
    expect(rankAvailableProviders(['mistral', 'groq'])).toEqual(['groq', 'mistral'])
  })
})
