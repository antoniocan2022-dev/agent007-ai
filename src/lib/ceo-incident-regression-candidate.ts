import type { ConversationIncidentContract } from './ceo-conversation-incident'
import { buildCanonicalConversationContext } from './ceo-cognitive-conversation'
import { deriveCeoConversationState } from './ceo-conversation-state'
import { buildConversationDecisionContract } from './ceo-conversation-decision-contract'

export type IncidentCandidateInputClass =
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
  | 'unclassified'

export interface IncidentRegressionCandidate {
  schemaVersion: 1
  fingerprint: string
  invariant: string
  inputClass: IncidentCandidateInputClass
  message: string
  observedIntent: string
  observedSpeechAct: string
  observedAction: string
  expectedIntent?: string
  expectedSpeechAct?: string
  expectedAction?: string
  reviewNotes?: string
  status: 'candidate' | 'approved' | 'rejected'
}

// A deliberately conservative, deterministic classifier for the KIND of input, not its correctness --
// this only labels the candidate for human triage, it never claims to know the right answer.
function classifyInputClass(message: string): IncidentCandidateInputClass {
  const text = message.trim()
  if (/^\s*(?:i\s+don['']?t\s+(?:understand|get\s+it)|i['']?m\s+confused|what\s+do\s+you\s+mean|i'?m\s+lost|this\s+doesn'?t\s+make\s+sense)\s*[.!?]*$/i.test(text)) return 'confusion'
  if (/^(?:no|that's not|that isn't|i mean|what i meant|correction)\b/i.test(text)) return 'correction'
  if (/\b(?:continue|go\s+back|return\s+to|same\s+as\s+before)\b/i.test(text) || /\bthe\s+(?:first|second|third|last|other)\b/i.test(text)) return 'continuation'
  if (/\b(?:ready|prepared|capable of|your (?:weakness|limitation|strength))\b/i.test(text)) return 'self_assessment'
  if (/\b(?:strategy|strategic|priorit(?:y|ize)|trade[- ]off|long[- ]term)\b/i.test(text)) return 'strategic_question'
  if (/\b(?:explain|why|how)\b/i.test(text)) return 'explanation_request'
  if (/\b(?:deploy|publish|ship|execute|send|create|delete|update|schedule)\b/i.test(text)) return 'action_request'
  if (/\b(?:it|this|that|these|those|they|them)\b/i.test(text) && text.split(/\s+/).length < 12) return 'reference'
  if (!/[a-z]{2,}\s+[a-z]{2,}/i.test(text) || text.length < 4) return 'typo_tolerance'
  if (/\b\w{1,2}$/.test(text) && !/[.!?]\s*$/.test(text)) return 'incomplete_message'
  return 'unclassified'
}

export function buildIncidentRegressionCandidate(input: { incident: ConversationIncidentContract; message: string }): IncidentRegressionCandidate {
  const state = deriveCeoConversationState([], input.message)
  const context = buildCanonicalConversationContext({ currentMessage: input.message, rows: [], state, references: [] })
  const contract = buildConversationDecisionContract(context)
  return {
    schemaVersion: 1,
    fingerprint: input.incident.fingerprint,
    invariant: input.incident.invariant,
    inputClass: classifyInputClass(input.message),
    message: input.message,
    observedIntent: contract.intent,
    observedSpeechAct: contract.speechAct,
    observedAction: contract.responseAction,
    status: 'candidate',
  }
}

// Emits the candidate as structured telemetry, distinct from the incident log itself, so
// candidates are discoverable without being confused with the incident stream they came from.
export function emitIncidentRegressionCandidate(input: { incident: ConversationIncidentContract; message: string }): IncidentRegressionCandidate {
  const candidate = buildIncidentRegressionCandidate(input)
  console.warn('[ceo-incident-candidate]', JSON.stringify(candidate))
  return candidate
}

// The only function in this module that produces something CI-enforceable. Deliberately requires
// a human-supplied, already-reviewed candidate (expectedIntent/expectedSpeechAct/expectedAction
// filled in, status explicitly 'approved') and a human-supplied category -- there is no path from
// a raw incident to this function that does not go through a person deciding the expected values
// are actually correct. This function does not write to any file or test corpus itself; it returns
// the exact fixture entry shape so a human can review and paste it into the behavioral corpus,
// keeping the actual promotion step a visible, reviewable code change rather than a silent write.
export function promoteApprovedCandidateToFixtureEntry(candidate: IncidentRegressionCandidate, name: string): { category: IncidentCandidateInputClass; name: string; message: string; expected: { intent: string; responseAction: string } } {
  if (candidate.status !== 'approved') throw new Error(`Cannot promote a candidate that has not been explicitly approved (status is "${candidate.status}"). Review the candidate and set status to "approved" with expectedIntent/expectedSpeechAct/expectedAction filled in first.`)
  if (!candidate.expectedIntent || !candidate.expectedAction) throw new Error('Cannot promote a candidate missing expectedIntent or expectedAction -- these must be supplied by human review, not inferred automatically.')
  return { category: candidate.inputClass, name, message: candidate.message, expected: { intent: candidate.expectedIntent, responseAction: candidate.expectedAction } }
}
