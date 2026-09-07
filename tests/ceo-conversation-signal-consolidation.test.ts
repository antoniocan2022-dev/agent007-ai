import { describe, expect, test } from 'bun:test'
import { deriveCeoConversationState, buildConversationStatePrompt } from '@/lib/ceo-conversation-state'
import { buildCanonicalConversationContext } from '@/lib/ceo-cognitive-conversation'
import { buildWorldStateSnapshot } from '@/lib/ceo-world-state'
import { isCorrectionRequest } from '@/lib/ceo-conversational-signals'

// Step 2 of the conversational re-architecture: consolidate the previously scattered
// topic/reference/correction signals onto CeoConversationState. Before this, "what counts as a
// correction" had four independent, disagreeing regex definitions (the canonical one in
// ceo-conversational-signals.ts, plus separate duplicates in ceo-world-state.ts and two places in
// ceo-cognitive-conversation.ts), and a correction's supersession effect was computed
// (computeWorldStateDelta) but only ever logged -- never actually excluded a corrected decision from
// the state that reaches the prompt. This file exercises the fix: one canonical correction
// classifier used everywhere, and corrections that actually supersede the decisions they correct.

function row(role: 'user' | 'assistant', content: string, createdAt: number) { return { role, content, createdAt } }

describe('CEO conversation state: corrections-as-supersession', () => {
  test('a correction supersedes an overlapping earlier decision: excluded from decisions, visible in supersededDecisions', () => {
    const rows = [
      row('user', 'The commercial priority is marketing automation.', 1),
      row('assistant', 'Understood.', 2),
      row('user', 'Correction: the commercial priority is recurring revenue.', 3),
    ]
    const state = deriveCeoConversationState(rows, 'What is the current priority?')
    expect(state.decisions.some((d) => d.includes('marketing automation'))).toBe(false)
    expect(state.decisions.some((d) => d.includes('recurring revenue'))).toBe(true)
    expect(state.supersededDecisions.some((d) => d.includes('marketing automation'))).toBe(true)
    const original = state.decisionSignals.find((signal) => signal.text.includes('marketing automation'))
    expect(original?.status).toBe('superseded')
    expect(original?.supersededBy).toContain('recurring revenue')
  })

  test('an unrelated later message does not falsely supersede an earlier decision', () => {
    const rows = [
      row('user', "Let's decide to use architecture priority one before adding new tools.", 1),
      row('user', 'By the way, what time zone are we using for deadlines?', 2),
    ]
    const state = deriveCeoConversationState(rows, 'What time zone?')
    expect(state.decisions.some((d) => d.includes('architecture priority one'))).toBe(true)
    expect(state.supersededDecisions.length).toBe(0)
  })

  test('the CONVERSATION STATE prompt surfaces superseded decisions as explicitly episodic, distinct from current ones', () => {
    const rows = [
      row('user', 'The commercial priority is marketing automation.', 1),
      row('user', 'Correction: the commercial priority is recurring revenue.', 2),
    ]
    const state = deriveCeoConversationState(rows, 'What is the priority?')
    const prompt = buildConversationStatePrompt(state, [])
    expect(prompt).toContain('Prior decisions (current): Correction: the commercial priority is recurring revenue.')
    expect(prompt).toContain('Superseded decisions (corrected by the user; episodic only, do not treat as current): The commercial priority is marketing automation.')
  })
})

describe('CEO conversation state: source tags distinguish user-asserted from assistant-stated', () => {
  test('a decision spoken by the assistant is tagged assistant_stated, not conflated with a user decision', () => {
    const rows = [
      row('assistant', "I've decided to recommend the slow, careful path instead.", 1),
    ]
    const state = deriveCeoConversationState(rows, 'What did you recommend?')
    const signal = state.decisionSignals.find((s) => s.text.includes('slow, careful path'))
    expect(signal?.source).toBe('assistant_stated')
  })

  test('a decision spoken by the user is tagged user_asserted', () => {
    const rows = [
      row('user', 'We agreed to use the fast provider path.', 1),
    ]
    const state = deriveCeoConversationState(rows, 'What did we agree?')
    const signal = state.decisionSignals.find((s) => s.text.includes('fast provider path'))
    expect(signal?.source).toBe('user_asserted')
  })
})

describe('CEO conversation state: one canonical correction classifier used everywhere', () => {
  // Before consolidation, ceo-world-state.ts and two call sites in ceo-cognitive-conversation.ts each
  // had their own bare "/^(?:no|...)\\b/i" regex that misclassified any message merely starting with
  // "no" as a correction -- disagreeing with the canonical isCorrectionRequest, which correctly
  // requires "no" to be followed by a real correction continuation (a comma/dash/colon plus a
  // referring word), not just any sentence that happens to start with "no".
  test('a message that starts with "no" but is not a correction is not misclassified as one', () => {
    const message = "No, let's continue with the current plan."
    expect(isCorrectionRequest(message)).toBe(false)

    const state = deriveCeoConversationState([], message)
    const context = buildCanonicalConversationContext({ currentMessage: message, rows: [], state, references: [] })
    expect(context.speechAct).not.toBe('correction')
    expect(context.speechAct).toBe('continuation')

    const rows = [row('user', 'We are building Agent007 into a strong executive partner.', 1), row('user', message, 2)]
    const snapshot = buildWorldStateSnapshot(deriveCeoConversationState(rows, message), rows)
    expect(snapshot.corrections.length).toBe(0)
  })

  test('a genuine correction is still classified as one everywhere', () => {
    const message = 'No, I meant recurring revenue.'
    expect(isCorrectionRequest(message)).toBe(true)

    const state = deriveCeoConversationState([], message)
    const context = buildCanonicalConversationContext({ currentMessage: message, rows: [], state, references: [] })
    expect(context.speechAct).toBe('correction')

    const rows = [row('user', 'The priority is marketing automation.', 1), row('user', message, 2)]
    const snapshot = buildWorldStateSnapshot(deriveCeoConversationState(rows, message), rows)
    expect(snapshot.corrections.length).toBeGreaterThan(0)
  })

  test('ceo-world-state.ts still surfaces a superseded decision (via state.decisions + state.supersededDecisions) with correct status', () => {
    const rows = [
      row('user', 'We are building Agent007 into a strong executive partner.', 0),
      row('assistant', 'The priority is stronger conversation quality.', 1),
      row('user', "Let's decide to use architecture priority one before adding new tools.", 2),
      row('assistant', 'Understood, prioritizing architecture work first.', 3),
      row('user', 'No, I meant we should prioritize tools before architecture instead.', 4),
    ]
    const state = deriveCeoConversationState(rows, 'What did we decide now?')
    const snapshot = buildWorldStateSnapshot(state, rows)
    const original = snapshot.decisions.find((record) => record.text.includes('architecture priority one'))
    expect(original?.status).toBe('superseded')
  })
})
