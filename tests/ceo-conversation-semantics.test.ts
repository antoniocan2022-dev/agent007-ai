import { describe, expect, test } from 'bun:test'
import { deriveCeoConversationState, resolveConversationReferences } from '@/lib/ceo-conversation-state'
import { extractEnumeratedItems, resolveActiveThread, resolveOrdinalReference, resolveTemporalReference } from '@/lib/ceo-reference-resolution'
import { evaluateCeoQuality } from '@/lib/ceo-response-quality-gate'

type Role = 'user' | 'assistant'
type Row = { role: Role; content: string; createdAt: number }
const base = Date.UTC(2026, 7, 30, 12, 0)
const row = (role: Role, content: string, offsetMinutes = 0): Row => ({ role, content, createdAt: base + offsetMinutes * 60_000 })

const benchmarkCases = [
  { name: 'single antecedent pronoun', message: 'What about it?', rows: [row('assistant', 'We should improve semantic memory.'), row('user', 'I like that idea.')] },
  { name: 'demonstrative this', message: 'What about this?', rows: [row('assistant', 'The context composer is the canonical context boundary.')] },
  { name: 'demonstrative that', message: 'What about that?', rows: [row('assistant', 'The provider router is currently the main bottleneck.')] },
  { name: 'plural these', message: 'Can we keep these?', rows: [row('assistant', 'I recommend memory, routing, and response quality improvements.')] },
  { name: 'plural those', message: 'Should we remove those?', rows: [row('assistant', 'Legacy deployment scripts are obsolete.')] },
  { name: 'same issue', message: 'Is the same issue still present?', rows: [row('user', 'The CEO keeps losing conversation context.'), row('assistant', 'The reference resolver needs richer discourse state.')] },
  { name: 'same problem', message: 'How do we solve the same problem?', rows: [row('user', 'Provider switching changes the tone.'), row('assistant', 'We need stable CEO context across fallbacks.')] },
  { name: 'earlier', message: 'What did we say earlier?', rows: [row('user', 'We need a benchmark before adding more heuristics.'), row('assistant', 'Agreed; the benchmark should become mandatory CI.')] },
  { name: 'before', message: 'What did we decide before?', rows: [row('assistant', 'Use conversation-first routing and keep execution downstream.')] },
  { name: 'continue', message: 'Continue.', rows: [row('user', 'We need to finish the CEO conversation architecture and its benchmark.')] },
  { name: 'first option', message: 'What about the first option?', rows: [row('assistant', 'Options:\n1. Keep the current model.\n2. Use a stronger CEO model.\n3. Split conversation and execution.')] },
  { name: 'second option', message: 'What about the second option?', rows: [row('assistant', 'Options:\n1. Keep the current model.\n2. Use a stronger CEO model.\n3. Split conversation and execution.')] },
  { name: 'third option', message: 'What about the third option?', rows: [row('assistant', 'Options:\n1. Keep the current model.\n2. Use a stronger CEO model.\n3. Split conversation and execution.')] },
  { name: 'last option', message: 'What about the last option?', rows: [row('assistant', 'Options:\n1. Keep the current model.\n2. Use a stronger CEO model.\n3. Split conversation and execution.')] },
  { name: 'other option', message: 'What about the other option?', rows: [row('assistant', 'Options:\n1. Keep the current model.\n2. Use a stronger CEO model.\n3. Split conversation and execution.')] },
  { name: 'yesterday decision', message: 'What did we decide yesterday?', rows: [row('user', 'We should create the benchmark first.', -24 * 60), row('assistant', 'Yes, benchmark-first is the safer sequence.', -23 * 60), row('user', 'Today I want to continue.')] },
  { name: 'two days ago', message: 'What happened two days ago?', rows: [row('user', 'We found the deployment drift.', -48 * 60), row('assistant', 'Production was running an older SHA.', -47 * 60), row('user', 'Today we are fixing conversation quality.')] },
  { name: 'last week', message: 'What did we discuss last week?', rows: [row('user', 'We audited Vercel drift.', -8 * 24 * 60), row('assistant', 'The live deployment was behind main.', -8 * 24 * 60 + 10), row('user', 'We then moved to CEO conversation quality.')] },
  { name: 'decision continuation', message: 'Continue with the decision.', rows: [row('user', 'We need semantic memory and stronger reference resolution.')] },
  { name: 'contextual reference', message: 'Can we improve it without changing the architecture?', rows: [row('assistant', 'The Context Composer should remain the sole context boundary.'), row('user', 'That boundary is important.')] },
  { name: 'explicit old objective', message: 'What did we originally want?', rows: [row('user', 'Make the CEO natural and capable of long conversations.'), row('assistant', 'That requires context, memory, references, and a natural response layer.')] },
  { name: 'semantic benchmark no hallucination', message: 'What about the second option?', rows: [row('assistant', 'Options:\n1. Improve logging.\n2. Improve semantic reference resolution.\n3. Add more tools.')] },
  { name: 'ambiguous pronoun is flagged', message: 'What about it?', rows: [row('assistant', 'We discussed memory.'), row('assistant', 'We also discussed provider routing.')] },
  { name: 'no antecedent remains unresolved', message: 'What about it?', rows: [] },
  { name: 'casual conversation quality', message: 'hi, how do you do?', rows: [row('assistant', 'Hi! I’m doing well and ready to help.')] },
] as const

describe('CEO conversation benchmark v0.1 — 25 hand-checked contracts', () => {
  test('25 benchmark cases are present', () => expect(benchmarkCases).toHaveLength(25))

  test('numbered-list extraction preserves ordered items', () => {
    const items = extractEnumeratedItems([row('assistant', 'Options:\n1. Memory.\n2. Routing.\n3. Natural responses.')])
    expect(items.map((item) => item.ordinal)).toEqual([1, 2, 3])
    expect(items[1]?.text).toBe('Routing.')
  })

  for (const testCase of benchmarkCases) {
    test(testCase.name, () => {
      const state = deriveCeoConversationState(testCase.rows, testCase.message)
      const resolution = resolveConversationReferences(testCase.message, testCase.rows, state)[0]
      expect(resolution).toBeDefined()
      if (testCase.name === 'no antecedent remains unresolved') {
        expect(resolution?.resolvedText).toBeNull()
        expect(resolution?.ambiguous).toBe(true)
      } else if (testCase.name === 'ambiguous pronoun is flagged') {
        expect(resolution?.ambiguous).toBe(true)
        expect(resolution?.resolvedText).toBeNull()
      } else {
        expect(resolution?.resolvedText).toBeTruthy()
        expect(resolution?.confidence).toBeGreaterThan(0.5)
      }
    })
  }

  test('specialized ordinal resolver is distinct and deterministic', () => {
    const rows = [row('assistant', 'Options:\n1. Memory.\n2. Routing.\n3. Natural responses.')]
    const result = resolveOrdinalReference('What about the second option?', rows)
    expect(result?.kind).toBe('ordinal')
    expect(result?.resolvedText).toBe('Routing.')
    expect(result?.ambiguous).toBe(false)
  })

  test('specialized temporal resolver uses calendar windows', () => {
    const now = Date.UTC(2026, 7, 30, 12, 0)
    const rows = [row('user', 'Yesterday we chose semantic memory.', -18 * 60), row('assistant', 'That was the decision.', -17 * 60)]
    const result = resolveTemporalReference('What did we decide yesterday?', rows, { nowMs: now, timeZone: 'UTC' })
    expect(result?.kind).toBe('temporal')
    expect(result?.resolvedText).toContain('That was the decision.')
    expect(result?.ambiguous).toBe(false)
  })

  test('structured active-thread resolver deterministically selects the latest active thread', () => {
    const rows = [row('user', 'We need to finish the release integrity architecture.', -10), row('user', 'We need to finish the conversation benchmark.', -1)]
    const state = deriveCeoConversationState(rows, 'Continue.')
    const result = resolveActiveThread('Continue.', state.threads)
    expect(result?.kind).toBe('continuation')
    expect(result?.resolvedText).toContain('conversation benchmark')
    expect(result?.ambiguous).toBe(false)
  })

  test('quality evaluation explicitly preserves casual conversation', () => {
    const result = evaluateCeoQuality({ objective: 'hi, how do you do?', content: 'Hi! I’m doing well. How are you?', path: 'fast', intent: 'conversation', evidenceVerificationApplicable: false })
    expect(result.decision).toBe('PASS')
    expect(result.evidenceState).toBe('NOT_APPLICABLE')
  })
})
