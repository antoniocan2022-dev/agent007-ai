import { describe, expect, test } from 'bun:test'
import { composeCeoContext } from '@/lib/ceo-context-composer'
import { evaluateCeoQuality } from '@/lib/ceo-response-quality-gate'
import { preRouteCeoRequest } from '@/lib/ceo-pre-router'

function row(role: 'user' | 'assistant', content: string, createdAt: number) {
  return { role, content, createdAt }
}

describe('CEO conversation continuity', () => {
  test('preserves recent turns and current context without duplicating the current message', () => {
    const current = 'What should we focus on next?'
    const context = composeCeoContext({
      systemPrompt: 'CEO identity.',
      currentUserMessage: current,
      persistedMessages: [
        row('user', 'We need to improve our customer retention.', 1),
        row('assistant', 'We should start by identifying the largest churn drivers.', 2),
        row('user', 'We have a small budget this month.', 3),
        row('assistant', 'Then we should prioritize low-cost retention experiments.', 4),
        row('user', current, 5),
      ],
      memories: [{ key: 'retention-priority', value: 'Customer retention is a current business priority.', category: 'strategy', updatedAt: 4 }],
    })

    const userMessages = context.messages.filter((message) => message.role === 'user' && message.content === current)
    expect(userMessages).toHaveLength(1)
    expect(context.messages.some((message) => message.content.includes('low-cost retention experiments'))).toBe(true)
    expect(context.selectedMemoryKeys).toEqual(['retention-priority'])
    expect(context.recentMessages).toBeGreaterThanOrEqual(2)
  })

  test('selects relevant older context and summarizes unrelated long history', () => {
    const current = 'Would you still recommend the retention experiment?'
    const context = composeCeoContext({
      systemPrompt: 'CEO identity.',
      currentUserMessage: current,
      persistedMessages: [
        row('user', 'Unrelated topic about office seating.', 1),
        row('assistant', 'Office seating can be revisited later.', 2),
        row('user', 'We discussed customer retention and the experiment should target churn.', 3),
        row('assistant', 'The retention experiment should focus on churn cohorts.', 4),
        row('user', current, 5),
      ],
      recentMessageLimit: 2,
      relevantOlderLimit: 2,
    })

    expect(context.relevantOlderMessages).toBeGreaterThan(0)
    expect(context.messages.some((message) => message.content.includes('retention experiment should focus on churn cohorts'))).toBe(true)
    expect(context.messages.some((message) => message.content.includes('OLDER CONVERSATION SUMMARY'))).toBe(true)
  })

  test('supports the original fifth-turn topic continuity scenario', () => {
    const messages = [
      { role: 'user', content: 'Let\'s discuss GEOS.' },
      { role: 'assistant', content: 'Sure. We can examine the company, financials, valuation, and risks.' },
      { role: 'user', content: 'Compare it with MIND.' },
      { role: 'assistant', content: 'I can compare the two companies using current external evidence.' },
      { role: 'user', content: 'Would you buy it?' },
    ] as const
    const decision = preRouteCeoRequest(messages)
    expect(decision.executionContract.evidenceClass).toBe('external_web')
    expect(decision.executionContract.domain).toBe('public_equity')
    expect(decision.executionContract.toolRequired).toBe(true)
    expect(decision.route).toBe('full')
  })

  test('conversation quality remains active while evidence verification is not applicable', () => {
    const quality = evaluateCeoQuality({
      objective: 'How do you do?',
      content: 'I am doing well and ready to help. What would you like to work on?',
      path: 'fast',
      externalExecutionSucceeded: true,
      evidenceVerificationApplicable: false,
    })
    expect(quality.decision).toBe('PASS')
    expect(quality.checks.nonEmpty).toBe(true)
    expect(quality.checks.objectiveCoverage).toBe(true)
    expect(quality.checks.evidenceDiscipline).toBe(true)
  })
})
