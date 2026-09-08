import { describe, expect, test } from 'bun:test'
import { deriveCeoConversationState, buildConversationStatePrompt } from '@/lib/ceo-conversation-state'
import { buildCanonicalConversationContext } from '@/lib/ceo-cognitive-conversation'
import { buildWorldStateSnapshot } from '@/lib/ceo-world-state'
import { buildCeoWorldModel } from '@/lib/ceo-world-model'
import { isCorrectionRequest, isContinuationOrRestatementRequest } from '@/lib/ceo-conversational-signals'
import { evaluateCeoQuality } from '@/lib/ceo-response-quality-gate'

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

describe('CEO conversation state: a question is never misclassified as a decision', () => {
  // Found auditing Step 2: DECISION_RE matches on keywords like "priority"/"decided" alone, with no
  // regard for whether the sentence is a question asking about a decision or an actual decision. A
  // message like "What is the current priority?" was silently entering state.decisions (and, after
  // Step 2, decisionSignals) as a freshly-tagged "current" user_asserted decision -- most visibly via
  // ceo-world-model.ts, which appends the current message as a row before deriving state, turning
  // every "what did we decide?"-style question into a spurious decision on every single turn.
  test('a bare question containing a decision keyword produces no decision signal', () => {
    const rows = [row('user', 'What is the current priority?', 1)]
    const state = deriveCeoConversationState(rows, 'What is the current priority?')
    expect(state.decisions).toEqual([])
    expect(state.decisionSignals).toEqual([])
  })

  test('the same bug does not resurface through ceo-world-model.ts, which re-derives state with the current message appended as a row', () => {
    const state = deriveCeoConversationState([], 'What is the current priority?')
    const context = buildCanonicalConversationContext({ currentMessage: 'What is the current priority?', rows: [], state, references: [] })
    const model = buildCeoWorldModel({ context, priorConversation: [] })
    expect(model.business.data.decisions).toEqual([])
  })

  test('a genuine decision statement is still captured even alongside an unrelated later question', () => {
    const rows = [
      row('user', 'The commercial priority is marketing automation.', 1),
      row('user', 'Should we prioritize the routing decision instead?', 2),
    ]
    const state = deriveCeoConversationState(rows, 'ok')
    expect(state.decisions).toEqual(['The commercial priority is marketing automation.'])
  })
})

// Live-transcript regression: a user asked Agent007 a business question, got a full answer, then said
// "mmm but tell me in your words." -- a legitimate request to restate that same answer more personally.
// Before this fix, "what counts as a continuation/restatement request" had four independent, drifting
// regex definitions (EXPLICIT_CONTINUATION_RE and a second inline exclusion inside staleResponseLikelihood
// in ceo-response-quality-gate.ts, plus isContinuityRecoveryRequest in ceo-degraded-mode.ts), none of which
// recognized restatement phrasing. staleResponseLikelihood -- built to catch a model lazily repeating its
// last answer instead of addressing a new question -- scored a correct paraphrase of the prior answer as
// suspicious, since a real paraphrase necessarily overlaps heavily with what it's paraphrasing while
// sharing almost no words with the meta-objective itself. That failureReason (continuity_failure) is on
// ceo-soft-pass-policy.ts's forbidden list, so it went straight to escalation, which also failed, landing on
// degraded mode's fully generic "I couldn't reliably complete that specific request..." bail-out -- verified
// live in production (request 99a00917, executedCommitSha a61a070d). Consolidated to one canonical
// isContinuationOrRestatementRequest, reused by all three sites.
describe('CEO conversation state: one canonical continuation/restatement classifier used everywhere', () => {
  test('isContinuationOrRestatementRequest recognizes restatement phrasing, including with a natural leading filler', () => {
    expect(isContinuationOrRestatementRequest('mmm but tell me in your words.')).toBe(true)
    expect(isContinuationOrRestatementRequest('tell me in your words')).toBe(true)
    expect(isContinuationOrRestatementRequest('put it in your own words')).toBe(true)
    expect(isContinuationOrRestatementRequest('how would you say that')).toBe(true)
  })

  test('isContinuationOrRestatementRequest still recognizes every phrasing the four prior definitions covered between them', () => {
    for (const phrase of ['continue', 'recap', 'summarize', 'remind me', 'from where we left off', 'what have we ruled out', 'what about the second option', 'based on what we established']) {
      expect(isContinuationOrRestatementRequest(phrase)).toBe(true)
    }
  })

  test('a genuinely new, unrelated objective is not misclassified as a continuation/restatement request', () => {
    expect(isContinuationOrRestatementRequest('Analyze the psychological patterns affecting my decisions.')).toBe(false)
    expect(isContinuationOrRestatementRequest("Let's continue building the pricing page.")).toBe(false)
  })

  const priorUser = 'are you ready for manage businesses with me?'
  const priorAssistant = "Good, honest question -- let me give you a straight answer. Where I'm at: I've got real operational structure underneath me -- three businesses, a working org of leaders and specialists across finance, legal, security, growth, and ops. So: yes, I'm in. What business are you interested in starting with?"
  const paraphrase = "Honestly? I'm a system built to run a business day-to-day -- coordinating the org, tracking decisions, keeping the numbers straight -- and I think I do that well. What I haven't done yet is prove it works without you watching closely. So I'm ready to start, I just wouldn't bet the farm on me solo yet."

  test('the exact failing transcript now passes: a restatement request no longer produces continuity_failure', () => {
    const result = evaluateCeoQuality({
      objective: 'mmm but tell me in your words.',
      content: paraphrase,
      path: 'fast',
      intent: 'conversation',
      responseAction: 'answer',
      priorTurns: [
        { role: 'user', content: priorUser, createdAt: 1 },
        { role: 'assistant', content: priorAssistant, createdAt: 2 },
      ],
    })
    expect(result.decision).toBe('PASS')
    expect(result.failureReason).toBeUndefined()
    expect(result.responseIntegrity?.staleResponseLikelihood).toBe(0)
  })

  test('genuine staleness -- a model ignoring a new, unrelated objective and pasting its old answer -- still fails', () => {
    const result = evaluateCeoQuality({
      objective: 'Analyze the psychological patterns affecting my decisions.',
      content: 'We should prioritize the operating foundation before adding complexity.',
      path: 'full',
      intent: 'conversation',
      responseAction: 'answer',
      priorTurns: [
        { role: 'user', content: 'What should we prioritize next?', createdAt: 1 },
        { role: 'assistant', content: 'Prioritize the operating foundation before adding complexity.', createdAt: 2 },
      ],
    })
    expect(result.decision).not.toBe('PASS')
  })

  // The degraded-mode-specific half of this regression (buildCeoDegradedResponse recognizing the same
  // restatement request) lives in tests/ceo-degraded-mode-continuation-restatement.test.ts instead of here:
  // that module transitively imports persistent-memory.ts -> db.ts, which this sandbox can't load
  // (pre-existing @prisma/client gap, unrelated to this change) -- keeping it out of this file preserves
  // this file's own local runnability, matching how ceo-conflict-benchmark-memory-evidence.test.ts is kept
  // separate from the Prisma-free conflict-benchmark tests for the same reason.
})
