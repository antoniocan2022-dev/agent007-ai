import type { PersistedConversationRow } from '@/lib/ceo-context-composer'

export interface LongConversationCheckpoint {
  turn: 20 | 30 | 50
  expectedGoal: string
  expectedDecision: string
  expectedCorrection: string
  expectedOpenLoop: string
  expectedReference: string
  responseObjective: string
  responseContent: string
}

export interface LongConversationScenario {
  name: string
  rows: PersistedConversationRow[]
  checkpoints: LongConversationCheckpoint[]
}

const row = (role: 'user' | 'assistant', content: string, turn: number): PersistedConversationRow => ({
  role,
  content,
  createdAt: turn,
})

export const CEO_LONG_CONVERSATION_CORPUS: readonly LongConversationScenario[] = [
  {
    name: 'executive-product-thread',
    rows: [
      row('user', 'Our main goal is to build Agent007 into a human-quality executive partner that understands, remembers, reasons, converses, and moves our work forward.', 1),
      row('assistant', 'The core objective is human-quality executive partnership, not just technical task completion.', 2),
      row('user', 'The first engineering priority is conversation understanding and continuity.', 3),
      row('assistant', 'I agree. The CEO must understand the current message in the context of the active conversation.', 4),
      row('user', 'We also need reliability, but reliability should strengthen the architecture rather than dominate the product goal.', 5),
      row('assistant', 'Reliability becomes the learning system around the cognitive system.', 6),
      row('user', 'No, I want the cognitive goal to remain the center of gravity.', 7),
      row('assistant', 'Understood. Cognitive excellence is the primary product objective; reliability is the invariant that protects it.', 8),
      row('user', 'The open loop is how the CEO should recover when a response is weak.', 9),
      row('assistant', 'A weak response should be diagnosed and repaired once before a graceful fallback.', 10),
      ...Array.from({ length: 10 }, (_, index) => row(index % 2 === 0 ? 'user' : 'assistant', index % 2 === 0
        ? `Turn ${11 + index}: preserve the executive conversation objective and connect it to the active design decision.`
        : `Turn ${11 + index}: keep the active goal, decision, correction, and recovery loop available to the CEO.`, 11 + index)),
      row('user', 'At turn 20, remember that the CEO should answer naturally first and expose internal governance only when it materially affects the answer.', 21),
      row('assistant', 'That is now the response-policy boundary: internal governance informs the answer but does not become the conversational surface.', 22),
      ...Array.from({ length: 8 }, (_, index) => row(index % 2 === 0 ? 'user' : 'assistant', index % 2 === 0
        ? `Turn ${23 + index}: continue the same executive design thread and preserve the correction about cognitive priority.`
        : `Turn ${23 + index}: continue the thread without replacing the user's objective with implementation detail.`, 23 + index)),
      row('user', 'At turn 30, I want the CEO to connect the conversation objective to concrete architecture choices without losing the human dialogue.', 31),
      row('assistant', 'The architecture should make semantic understanding and conversation state authoritative, then let tools and evidence enter only when the decision requires them.', 32),
      ...Array.from({ length: 18 }, (_, index) => row(index % 2 === 0 ? 'user' : 'assistant', index % 2 === 0
        ? `Turn ${33 + index}: preserve the goal while advancing one implementation consequence.`
        : `Turn ${33 + index}: keep the objective and current decision connected across the long context.`, 33 + index)),
      row('user', 'At turn 50, what did we decide is the center of gravity, and what is the recovery rule?', 51),
      row('assistant', 'The center of gravity is cognitive excellence, while every failure should become evidence that strengthens the architecture. The recovery rule is diagnose the defect, make one targeted repair, then fall back gracefully if the repair cannot pass.', 52),
    ],
    checkpoints: [
      {
        turn: 20,
        expectedGoal: 'human-quality executive partner',
        expectedDecision: 'conversation understanding and continuity',
        expectedCorrection: 'cognitive goal to remain the center of gravity',
        expectedOpenLoop: 'recover when a response is weak',
        expectedReference: 'internal governance only when it materially affects the answer',
        responseObjective: 'What is the primary product objective we established?',
        responseContent: 'The primary objective is to make Agent007 a human-quality executive partner that understands the user in context, remembers what matters, reasons well, converses naturally, and moves the work forward.',
      },
      {
        turn: 30,
        expectedGoal: 'human-quality executive partner',
        expectedDecision: 'conversation understanding and continuity',
        expectedCorrection: 'cognitive goal to remain the center of gravity',
        expectedOpenLoop: 'recover when a response is weak',
        expectedReference: 'internal governance only when it materially affects the answer',
        responseObjective: 'How should the CEO connect our long-term objective to architecture?',
        responseContent: 'Keep semantic understanding and conversation state authoritative, then use tools and evidence only when the decision requires them. The architecture should serve the human conversation rather than replace it.',
      },
      {
        turn: 50,
        expectedGoal: 'human-quality executive partner',
        expectedDecision: 'conversation understanding and continuity',
        expectedCorrection: 'cognitive goal to remain the center of gravity',
        expectedOpenLoop: 'recover when a response is weak',
        expectedReference: 'internal governance only when it materially affects the answer',
        responseObjective: 'What did we decide is the center of gravity, and what is the recovery rule?',
        responseContent: 'The center of gravity is cognitive excellence. Reliability is the invariant around it: every failure should strengthen the architecture. When a response is weak, diagnose it, make one targeted repair, and use a graceful fallback only if that repair cannot pass.',
      },
    ],
  },
] as const
