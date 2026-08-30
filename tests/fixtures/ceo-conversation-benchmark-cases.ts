export type ConversationRole = 'user' | 'assistant'
export type ConversationBenchmarkRow = { role: ConversationRole; content: string; createdAt: number }
export type ConversationBenchmarkCase = { name: string; message: string; rows: ConversationBenchmarkRow[] }

const base = Date.UTC(2026, 7, 30, 12, 0)
const row = (role: ConversationRole, content: string, offsetMinutes = 0): ConversationBenchmarkRow => ({ role, content, createdAt: base + offsetMinutes * 60_000 })

export const CEO_CONVERSATION_BENCHMARK_CASES: ConversationBenchmarkCase[] = [
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
]
