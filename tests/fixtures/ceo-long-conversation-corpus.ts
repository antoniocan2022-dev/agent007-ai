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

const row = (role: 'user' | 'assistant', content: string, turn: number): PersistedConversationRow => ({ role, content, createdAt: turn })

function buildRows(): PersistedConversationRow[] {
  const rows: PersistedConversationRow[] = [
    row('user', 'Our main goal is to build Agent007 into a human-quality executive partner that understands, remembers, reasons, converses, and moves our work forward.', 1),
    row('assistant', 'The core objective is human-quality executive partnership, not just technical task completion.', 2),
    row('user', 'The first engineering priority is conversation understanding and continuity.', 3),
    row('assistant', 'The CEO must understand the current message in the context of the active conversation.', 4),
    row('user', 'We also need reliability, but reliability should strengthen the architecture rather than dominate the product goal.', 5),
    row('assistant', 'Reliability is the learning system around the cognitive system.', 6),
    row('user', 'No, I want the cognitive goal to remain the center of gravity.', 7),
    row('assistant', 'Understood. Cognitive excellence is the primary product objective; reliability is the invariant that protects it.', 8),
    row('user', 'How should the CEO recover when a response is weak?', 9),
    row('assistant', 'Diagnose the defect, make one targeted repair, and use a graceful fallback only when the repair cannot pass.', 10),
  ]
  for (let turn = 11; turn <= 20; turn += 1) {
    rows.push(row(turn % 2 === 1 ? 'user' : 'assistant', turn % 2 === 1
      ? `Turn ${turn}: preserve the executive conversation objective and connect it to the active design decision.`
      : `Turn ${turn}: keep the active goal, decision, correction, and recovery loop available to the CEO.`, turn))
  }
  for (let turn = 21; turn <= 30; turn += 1) {
    rows.push(row(turn % 2 === 1 ? 'user' : 'assistant', turn % 2 === 1
      ? `Turn ${turn}: keep cognitive excellence as the center of gravity while the architecture becomes more reliable.`
      : `Turn ${turn}: do not replace the human conversation with internal governance language.`, turn))
  }
  for (let turn = 31; turn <= 40; turn += 1) {
    rows.push(row(turn % 2 === 1 ? 'user' : 'assistant', turn % 2 === 1
      ? `Turn ${turn}: connect semantic understanding and conversation state to the implementation without losing the user objective.`
      : `Turn ${turn}: tools and evidence should enter only when the decision actually requires them.`, turn))
  }
  for (let turn = 41; turn <= 50; turn += 1) {
    rows.push(row(turn % 2 === 1 ? 'user' : 'assistant', turn === 41
      ? 'At the final phase, remember that internal governance informs the answer but should not become the conversational surface.'
      : turn % 2 === 1
        ? `Turn ${turn}: preserve the same cognitive goal and recovery rule across the long conversation.`
        : `Turn ${turn}: keep the active objective connected to the latest architectural choice.`, turn))
  }
  return rows
}

export const CEO_LONG_CONVERSATION_CORPUS: readonly LongConversationScenario[] = [
  {
    name: 'executive-product-thread',
    rows: buildRows(),
    checkpoints: [
      {
        turn: 20,
        expectedGoal: 'human-quality executive partner',
        expectedDecision: 'conversation understanding and continuity',
        expectedCorrection: 'cognitive goal to remain the center of gravity',
        expectedOpenLoop: 'How should the CEO recover when a response is weak?',
        expectedReference: 'internal governance language',
        responseObjective: 'What is the primary product objective we established?',
        responseContent: 'The primary objective is to make Agent007 a human-quality executive partner that understands the user in context, remembers what matters, reasons well, converses naturally, and moves the work forward.',
      },
      {
        turn: 30,
        expectedGoal: 'human-quality executive partner',
        expectedDecision: 'conversation understanding and continuity',
        expectedCorrection: 'cognitive goal to remain the center of gravity',
        expectedOpenLoop: 'How should the CEO recover when a response is weak?',
        expectedReference: 'internal governance language',
        responseObjective: 'How should the CEO connect our long-term objective to architecture?',
        responseContent: 'Keep semantic understanding and conversation state authoritative, then use tools and evidence only when the decision requires them. The architecture should serve the human conversation rather than replace it.',
      },
      {
        turn: 50,
        expectedGoal: 'human-quality executive partner',
        expectedDecision: 'conversation understanding and continuity',
        expectedCorrection: 'cognitive goal to remain the center of gravity',
        expectedOpenLoop: 'How should the CEO recover when a response is weak?',
        expectedReference: 'internal governance language',
        responseObjective: 'What did we decide is the center of gravity, and what is the recovery rule?',
        responseContent: 'The center of gravity is cognitive excellence. Reliability is the invariant around it: every failure should strengthen the architecture. When a response is weak, diagnose it, make one targeted repair, and use a graceful fallback only if that repair cannot pass.',
      },
    ],
  },
] as const
