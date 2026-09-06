import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { isCurrentTopicRequest } from '@/lib/ceo-conversational-signals'
import { scoreContextContinuity } from '@/lib/ceo-context-intelligence'
import { evaluateCeoQuality } from '@/lib/ceo-response-quality-gate'
import { isGovernedSoftPassEligible } from '@/lib/ceo-soft-pass-policy'
import { extractEnumeratedItems } from '@/lib/ceo-reference-resolution'

describe('CEO deep-audit hardening regressions', () => {
  test('provider resilience is a deploy-blocking exact-SHA gate and triggers on every main push', () => {
    const watchdog = readFileSync('.github/workflows/production-release-watchdog.yml', 'utf8')
    const providerWorkflow = readFileSync('.github/workflows/provider-resilience-ci.yml', 'utf8')

    expect(watchdog).toContain('"Provider Resilience CI"')
    expect(providerWorkflow).toMatch(/push:\s*\n\s+branches: \[main\]/)
    expect(providerWorkflow).not.toMatch(/push:\s*\n[\s\S]*?paths:/)
  })

  test('CI tsconfig actually includes bun-types and the two architecture test files', () => {
    const tsconfig = JSON.parse(readFileSync('tsconfig.ci.json', 'utf8')) as {
      compilerOptions?: { types?: string[] }
      include?: string[]
    }
    expect(tsconfig.compilerOptions?.types).toContain('bun-types')
    expect(tsconfig.include).toContain('tests/ceo-conversation-completion.test.ts')
    expect(tsconfig.include).toContain('tests/provider-auth-failover.test.ts')
  })

  test('phrasing-only decide misses are quality failures and remain soft-pass eligible', () => {
    const result = evaluateCeoQuality({
      objective: 'What should we choose for the provider architecture?',
      content: 'My preferred direction is to use the provider architecture with Cerebras as the fallback.',
      path: 'fast',
      intent: 'decision',
      evidenceVerificationApplicable: false,
    })
    expect(result.failureReason).toBe('quality_failure')
    expect(isGovernedSoftPassEligible({
      intent: 'decision',
      qualityDecision: 'ESCALATE',
      failureReason: result.failureReason,
      conversationScore: 80,
      substantive: true,
    })).toBe(true)
  })

  test('genuine cross-objective substitution remains ineligible for soft-pass', () => {
    const result = evaluateCeoQuality({
      objective: 'What should we choose for the revenue model?',
      content: 'The provider architecture decision remains the best direction.',
      path: 'fast',
      intent: 'decision',
      priorTurns: [
        { role: 'user' as const, content: 'Continue with the provider architecture decision.', createdAt: '2026-09-06T12:00:00.000Z' },
      ],
      evidenceVerificationApplicable: false,
    })
    expect(result.failureReason).toBe('continuity_failure')
    expect(isGovernedSoftPassEligible({
      intent: 'decision',
      qualityDecision: 'ESCALATE',
      failureReason: result.failureReason,
      conversationScore: 90,
      substantive: true,
    })).toBe(false)
  })

  test('vague current-topic follow-up remains protected without terminal punctuation', () => {
    expect(isCurrentTopicRequest('Where are we with this')).toBe(true)
    const continuity = scoreContextContinuity({
      currentUserMessage: 'Where are we with this',
      response: 'We are discussing revenue growth and customer acquisition.',
      priorTurns: [
        { role: 'user' as const, content: 'Now let us discuss provider architecture.', createdAt: '2026-09-06T12:00:00.000Z' },
        { role: 'assistant' as const, content: 'We are discussing provider architecture and resilience.', createdAt: '2026-09-06T12:00:05.000Z' },
      ],
    })
    expect(continuity.score).toBeLessThanOrEqual(40)
    expect(continuity.understood).toBe(false)
  })

  test('specific one-token questions are not misclassified as vague current-topic requests', () => {
    expect(isCurrentTopicRequest('What is revenue?')).toBe(false)
    expect(isCurrentTopicRequest('What is revenue')).toBe(false)
  })

  test('ordinal and temporal references remain outside current-topic signaling', () => {
    expect(isCurrentTopicRequest('The second one?')).toBe(false)
    expect(isCurrentTopicRequest('What did we discover yesterday?')).toBe(false)
  })

  test('pending list headers expire after one intervening row', () => {
    const rows = [
      { role: 'assistant' as const, content: 'Alternative options:', createdAt: '2026-09-06T12:01:00.000Z' },
      { role: 'assistant' as const, content: 'Let us discuss provider resilience first.', createdAt: '2026-09-06T12:01:10.000Z' },
      { role: 'assistant' as const, content: '2. Unrelated later list item.', createdAt: '2026-09-06T12:01:20.000Z' },
    ]
    const items = extractEnumeratedItems(rows)
    expect(items.map((item) => `${item.listId}:${item.ordinal}`)).toEqual(['list-0:2'])
  })
})
