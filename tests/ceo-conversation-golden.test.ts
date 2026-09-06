import { describe, expect, test } from 'bun:test'
import { deriveCeoConversationState, resolveConversationReferences } from '@/lib/ceo-conversation-state'

type Role = 'user' | 'assistant'
type Row = { role: Role; content: string; createdAt: number }
const t = (n: number) => Date.UTC(2026, 7, 30, 12, n)
const row = (role: Role, content: string, minute: number): Row => ({ role, content, createdAt: t(minute) })

const conversations = [
  { name: 'deployment-thread', rows: [row('user', 'We need to validate the production deployment path.', 0), row('assistant', 'There are three candidates:\n1. GitHub main certification.\n2. Manual Vercel deployment.\n3. Automatic Git deployment.', 1), row('user', 'I prefer the second one because it keeps authorization explicit.', 2)], prompts: [['What about the second option?', 'Manual Vercel deployment.'], ['Continue.', 'deployment']] },
  { name: 'memory-thread', rows: [row('user', 'Our biggest issue is long conversation memory.', 0), row('assistant', 'We should retain meaning rather than every raw token.', 1), row('user', 'That principle should guide the next upgrade.', 2)], prompts: [['What did we say earlier?', 'retain meaning'], ['Continue.', 'memory']] },
  { name: 'provider-thread', rows: [row('user', 'Provider switching can change the CEO tone.', 0), row('assistant', 'The fallback should preserve identity, context, and style.', 1), row('user', 'That is more important than minimizing latency.', 2)], prompts: [['What about that?', 'fallback should preserve identity'], ['Continue.', 'Provider switching']] },
  { name: 'revenue-thread', rows: [row('user', 'We want Agent007 to generate real business outcomes.', 0), row('assistant', 'The first priority is repeatable customer value.', 1), row('user', 'The second priority is measurement.', 2), row('assistant', 'That gives us a business loop rather than a demo.', 3)], prompts: [['What did we decide earlier?', 'business loop'], ['Continue.', 'Agent007']] },
  { name: 'topic-shift', rows: [row('user', 'We are discussing CEO conversation quality.', 0), row('assistant', 'The missing pieces are reference resolution and semantic memory.', 1), row('user', 'Forget that for a moment. We need to discuss deployment safety.', 2), row('assistant', 'Deployment safety depends on exact SHA certification.', 3)], prompts: [['What about the current issue?', 'Deployment safety'], ['Continue.', 'deployment']] },
  { name: 'correction-thread', rows: [row('user', 'There are three weaknesses: memory, routing, and naturalness.', 0), row('assistant', 'I would prioritize memory first.', 1), row('user', 'No, I meant routing as the first engineering priority.', 2)], prompts: [['What about the first one?', 'memory'], ['Continue.', 'routing']] },
  { name: 'temporal-thread', rows: [row('user', 'Yesterday we discovered that Vercel was behind main.', -24 * 60), row('assistant', 'Today we should verify the production SHA.', -23 * 60), row('user', 'What did we decide yesterday?', 0)], prompts: [['What did we decide yesterday?', 'behind main'], ['Continue.', 'verify the production SHA']] },
  { name: 'ambiguous-thread', rows: [row('assistant', 'We need stronger memory.', 0), row('assistant', 'We also need stronger provider routing.', 1), row('user', 'Both remain important.', 2)], prompts: [['What about it?', null], ['Continue.', 'Both remain important']] },
  { name: 'execution-transition', rows: [row('user', 'First let us talk naturally about the release.', 0), row('assistant', 'The release candidate should be certified before production mutation.', 1), row('user', 'Now check the live deployment.', 2)], prompts: [['What about the release candidate?', 'certified before production mutation'], ['Continue.', 'check the live deployment']] },
  { name: 'long-thread', rows: Array.from({ length: 20 }, (_, index) => row(index % 2 === 0 ? 'user' : 'assistant', index === 0 ? 'We will build a human-quality CEO conversation engine.' : `Conversation turn ${index}: preserve context and advance the active topic.`, index)), prompts: [['What did we originally want?', 'human-quality CEO conversation engine'], ['Continue.', 'preserve context']] },
] as const

describe('CEO golden conversation benchmark v0.1 — 10 sustained dialogues', () => {
  for (const scenario of conversations) {
    test(scenario.name, () => {
      const state = deriveCeoConversationState(scenario.rows, scenario.rows.at(-1)?.content ?? '')
      for (const [message, expected] of scenario.prompts) {
        const resolution = resolveConversationReferences(message, scenario.rows, state)[0]
        expect(resolution).toBeDefined()
        if (expected === null) {
          expect(resolution?.ambiguous).toBe(true)
          expect(resolution?.resolvedText).toBeNull()
        } else {
          expect(typeof resolution?.resolvedText).toBe('string')
          expect(resolution?.resolvedText?.toLowerCase()).toContain(expected.toLowerCase())
          expect(resolution?.confidence).toBeGreaterThan(0.5)
        }
      }
    })
  }
})

describe('Thread segmentation stays consistent once a thread crosses the wall-clock pause boundary', () => {
  // Anchored to Date.now() minus 8 days (buildThreads marks a thread 'paused' past 7 days of
  // inactivity), not a fixed calendar date -- this reproduces the exact bug this suite hit on
  // 2026-09-06 without depending on ever landing near that boundary again by coincidence.
  const anchor = Date.now() - 1000 * 60 * 60 * 24 * 8
  const oldRow = (role: Role, content: string, minuteOffset: number): Row => ({ role, content, createdAt: anchor + minuteOffset * 60_000 })

  test('a second user message on the same topic, arriving after the thread is already past the pause threshold, still merges into that thread instead of forking a new one', () => {
    const rows = [
      oldRow('user', 'Provider switching can change the CEO tone.', 0),
      oldRow('assistant', 'The fallback should preserve identity, context, and style.', 1),
      oldRow('user', 'That is more important than minimizing latency.', 2),
    ]
    const state = deriveCeoConversationState(rows, rows.at(-1)?.content ?? '')
    expect(state.threads.length).toBe(1)
    const resolution = resolveConversationReferences('Continue.', rows, state)[0]
    expect(resolution?.resolvedText?.toLowerCase()).toContain('provider switching')
  })

  test('a thread past the pause threshold still carries its most recent assistant reply forward on continuation', () => {
    const rows = [
      oldRow('user', 'Yesterday we discovered that Vercel was behind main.', 0),
      oldRow('assistant', 'Today we should verify the production SHA.', 1),
      oldRow('user', 'What did we decide yesterday?', 2),
    ]
    const state = deriveCeoConversationState(rows, rows.at(-1)?.content ?? '')
    const resolution = resolveConversationReferences('Continue.', rows, state)[0]
    expect(resolution?.resolvedText?.toLowerCase()).toContain('verify the production sha')
  })
})
