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
      ? `Turn ${turn}: preserve the executive conversation objective and connect it to what we already committed to build.`
      : `Turn ${turn}: keep the active goal, correction, and recovery loop available to the CEO.`, turn))
  }
  for (let turn = 21; turn <= 30; turn += 1) {
    rows.push(row(turn % 2 === 1 ? 'user' : 'assistant', turn % 2 === 1
      ? `Turn ${turn}: keep cognitive excellence as the main focus while the architecture becomes more reliable.`
      : `Turn ${turn}: do not replace the human conversation with internal governance language.`, turn))
  }
  for (let turn = 31; turn <= 40; turn += 1) {
    rows.push(row(turn % 2 === 1 ? 'user' : 'assistant', turn % 2 === 1
      ? `Turn ${turn}: connect semantic understanding and conversation state to the implementation without losing the user objective.`
      : `Turn ${turn}: tools and evidence should enter only when the answer actually requires them.`, turn))
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

function buildPersonalWellbeingRows(): PersistedConversationRow[] {
  const rows: PersistedConversationRow[] = [
    row('user', 'My main goal right now is to build a sustainable running habit and finish a half marathon without wrecking my sleep or my knee.', 1),
    row('assistant', 'The core goal is a sustainable running habit and a finished half marathon, protected by good sleep and a healthy knee, not just a mileage number.', 2),
    row('user', 'My priority is consistency -- three shorter runs a week, not seven days of pushing hard.', 3),
    row('assistant', 'Understood. Three consistent runs a week is the anchor; daily high-mileage running is not the plan.', 4),
    row('user', 'I also want to clean up my diet, but that should support the running goal rather than turn into its own separate project.', 5),
    row('assistant', 'Diet is the support system around the running habit, not a second goal competing with it.', 6),
    row('user', 'No, I want the running habit itself to stay the main focus, not the diet changes.', 7),
    row('assistant', 'Understood. The running habit remains the primary focus; diet is a supporting habit, not the center of the plan.', 8),
    row('user', 'What should I do if my knee starts hurting again during training?', 9),
    row('assistant', "Back off the pace for two days, ice it after each run, and only resume full effort once it's pain-free at a brisk walk.", 10),
  ]
  for (let turn = 11; turn <= 20; turn += 1) {
    rows.push(row(turn % 2 === 1 ? 'user' : 'assistant', turn % 2 === 1
      ? `Turn ${turn}: preserve the running-habit goal and connect it to the three-runs-a-week commitment we already made.`
      : `Turn ${turn}: keep the goal, correction, and knee-recovery rule available for training choices.`, turn))
  }
  for (let turn = 21; turn <= 30; turn += 1) {
    rows.push(row(turn % 2 === 1 ? 'user' : 'assistant', turn % 2 === 1
      ? `Turn ${turn}: keep the running habit as the main focus while the diet changes stay supportive.`
      : `Turn ${turn}: do not let meal planning replace the actual training conversation.`, turn))
  }
  for (let turn = 31; turn <= 40; turn += 1) {
    rows.push(row(turn % 2 === 1 ? 'user' : 'assistant', turn % 2 === 1
      ? `Turn ${turn}: connect the training schedule and knee-recovery rule to this week's plan without losing the original goal.`
      : `Turn ${turn}: extra workouts or gear only matter when they actually protect the knee or the sleep goal.`, turn))
  }
  for (let turn = 41; turn <= 50; turn += 1) {
    rows.push(row(turn % 2 === 1 ? 'user' : 'assistant', turn === 41
      ? 'At this point in training, remember that the diet changes support the plan but should not become the main conversation.'
      : turn % 2 === 1
        ? `Turn ${turn}: preserve the same running goal and knee-recovery rule across the whole training block.`
        : `Turn ${turn}: keep the current week's training connected to the original goal and the knee rule.`, turn))
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
        responseContent: 'The primary product objective we established is to make Agent007 a human-quality executive partner that understands you in context, remembers what matters, reasons well, converses naturally, and moves the work forward.',
      },
      {
        turn: 30,
        expectedGoal: 'human-quality executive partner',
        expectedDecision: 'conversation understanding and continuity',
        expectedCorrection: 'cognitive goal to remain the center of gravity',
        expectedOpenLoop: 'How should the CEO recover when a response is weak?',
        expectedReference: 'internal governance language',
        responseObjective: 'How should the CEO connect our long-term objective to architecture?',
        responseContent: 'The architecture should connect back to our long-term objective: keep semantic understanding and conversation state authoritative, then bring in tools and evidence only when the objective actually requires them, so the architecture serves the conversation rather than replacing it.',
      },
      {
        turn: 50,
        expectedGoal: 'human-quality executive partner',
        expectedDecision: 'conversation understanding and continuity',
        expectedCorrection: 'cognitive goal to remain the center of gravity',
        expectedOpenLoop: 'How should the CEO recover when a response is weak?',
        expectedReference: 'internal governance language',
        responseObjective: 'What did we decide is the center of gravity, and what is the recovery rule?',
        responseContent: 'We decided the center of gravity is cognitive excellence. Reliability is the invariant around it: every failure should strengthen the architecture. The recovery rule when a response is weak is to diagnose it, make one targeted repair, and use a graceful fallback only if that repair cannot pass.',
      },
    ],
  },
  {
    name: 'personal-wellbeing-thread',
    rows: buildPersonalWellbeingRows(),
    checkpoints: [
      {
        turn: 20,
        expectedGoal: 'sustainable running habit',
        expectedDecision: 'three shorter runs a week',
        expectedCorrection: 'running habit itself to stay the main focus',
        expectedOpenLoop: 'What should I do if my knee starts hurting again during training?',
        expectedReference: 'meal planning replacing the training conversation',
        responseObjective: 'What is the main training goal we established?',
        responseContent: "The main training goal we established is to build a sustainable running habit and finish a half marathon, running three times a week while protecting your sleep and your knee instead of chasing daily mileage.",
      },
      {
        turn: 30,
        expectedGoal: 'sustainable running habit',
        expectedDecision: 'three shorter runs a week',
        expectedCorrection: 'running habit itself to stay the main focus',
        expectedOpenLoop: 'What should I do if my knee starts hurting again during training?',
        expectedReference: 'meal planning replacing the training conversation',
        responseObjective: 'How should the training plan connect the diet changes to the original goal?',
        responseContent: 'The training plan should connect the diet changes back to the original goal: keep the running habit and the three-times-a-week schedule authoritative, and bring in diet changes only when they actually support better runs, so diet serves the training plan instead of replacing it.',
      },
      {
        turn: 50,
        expectedGoal: 'sustainable running habit',
        expectedDecision: 'three shorter runs a week',
        expectedCorrection: 'running habit itself to stay the main focus',
        expectedOpenLoop: 'What should I do if my knee starts hurting again during training?',
        expectedReference: 'meal planning replacing the training conversation',
        responseObjective: 'What did we decide is the main focus, and what is the knee-recovery rule?',
        responseContent: "We decided the main focus is the running habit itself, with three runs a week as the anchor and diet as a supporting habit, not a competing goal. The knee-recovery rule is: back off the pace for two days, ice it after each run, and only resume full effort once it's pain-free at a brisk walk.",
      },
    ],
  },
] as const
