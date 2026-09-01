export type BehavioralCategory =
  | 'confusion'
  | 'typo_tolerance'
  | 'incomplete_message'
  | 'correction'
  | 'reference'
  | 'continuation'
  | 'self_assessment'
  | 'strategic_question'
  | 'explanation_request'
  | 'action_request'

export interface BehavioralCase {
  category: BehavioralCategory
  name: string
  message: string
  expected: {
    completeness: 'complete' | 'partial' | 'insufficient'
    responseRegister: 'conversational' | 'executive' | 'analytical' | 'strategic' | 'instructional'
    clarificationRequired: boolean
    intent: 'conversation' | 'analysis' | 'decision' | 'research' | 'action' | 'unknown'
  }
}

export const CEO_CONVERSATION_BEHAVIORAL_CORPUS: readonly BehavioralCase[] = [
  { category: 'confusion', name: 'plain confusion', message: "I don't understand.", expected: { completeness: 'complete', responseRegister: 'conversational', clarificationRequired: false, intent: 'conversation' } },
  { category: 'confusion', name: 'informal confusion', message: "I dont get it.", expected: { completeness: 'complete', responseRegister: 'conversational', clarificationRequired: false, intent: 'conversation' } },
  { category: 'typo_tolerance', name: 'imperfection remains understandable', message: 'I would like you can tell me in yours words.', expected: { completeness: 'complete', responseRegister: 'conversational', clarificationRequired: false, intent: 'conversation' } },
  { category: 'typo_tolerance', name: 'short typo statement', message: 'We are buol', expected: { completeness: 'complete', responseRegister: 'conversational', clarificationRequired: false, intent: 'conversation' } },
  { category: 'incomplete_message', name: 'cut off after conjunction', message: 'We are building the structure, deep comprehension of your weaknesses and i', expected: { completeness: 'partial', responseRegister: 'conversational', clarificationRequired: true, intent: 'conversation' } },
  { category: 'incomplete_message', name: 'cut off after fragment', message: 'Compliance. But before explain me mi', expected: { completeness: 'partial', responseRegister: 'conversational', clarificationRequired: true, intent: 'conversation' } },
  { category: 'correction', name: 'explicit correction', message: "No, I meant routing as the first engineering priority.", expected: { completeness: 'complete', responseRegister: 'conversational', clarificationRequired: false, intent: 'conversation' } },
  { category: 'reference', name: 'ordinal reference', message: 'What about the second option?', expected: { completeness: 'complete', responseRegister: 'conversational', clarificationRequired: true, intent: 'conversation' } },
  { category: 'continuation', name: 'continue current thread', message: 'Continue.', expected: { completeness: 'complete', responseRegister: 'conversational', clarificationRequired: false, intent: 'conversation' } },
  { category: 'self_assessment', name: 'leadership readiness', message: 'Are you ready to lead businesses?', expected: { completeness: 'complete', responseRegister: 'conversational', clarificationRequired: false, intent: 'conversation' } },
  { category: 'strategic_question', name: 'strategic direction', message: 'Where should we put our attention at the beginning?', expected: { completeness: 'complete', responseRegister: 'strategic', clarificationRequired: false, intent: 'conversation' } },
  { category: 'explanation_request', name: 'explain simply', message: 'Can you explain that in simple words?', expected: { completeness: 'complete', responseRegister: 'conversational', clarificationRequired: false, intent: 'conversation' } },
  { category: 'action_request', name: 'specific action', message: 'Please create the implementation checklist.', expected: { completeness: 'complete', responseRegister: 'instructional', clarificationRequired: false, intent: 'action' } },
] as const
