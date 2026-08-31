import type { CeoIntent } from './ceo-cognitive-contract'
import type { CeoFailureReason } from './ceo-failure-reason'

export type ConversationIncidentCategory = 'understanding' | 'state' | 'reference' | 'routing' | 'quality' | 'personality' | 'provider' | 'stream' | 'unknown'

export interface ConversationIncidentContract {
  schemaVersion: 1
  fingerprint: string
  category: ConversationIncidentCategory
  intent: CeoIntent
  failureReason: CeoFailureReason
  invariant: string
}

function categoryFor(reason: CeoFailureReason): ConversationIncidentCategory {
  if (reason === 'continuity_failure') return 'state'
  if (reason === 'quality_failure' || reason === 'claim_consistency_failure') return 'quality'
  if (reason === 'context_unavailable') return 'understanding'
  if (reason.startsWith('provider_') || reason === 'execution_timeout') return 'provider'
  return 'unknown'
}

function stableFingerprint(intent: CeoIntent, reason: CeoFailureReason, objective: string): string {
  const normalized = objective.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 240)
  let hash = 2166136261
  for (const char of `${intent}|${reason}|${normalized}`) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return `ceo-inc-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function buildConversationIncidentContract(input: { objective: string; intent: CeoIntent; failureReason: CeoFailureReason }): ConversationIncidentContract {
  const category = categoryFor(input.failureReason)
  const invariant = category === 'state'
    ? 'Relevant conversational context must remain available whenever continuity is required.'
    : category === 'quality'
      ? 'A generated conversational answer must be evaluated against its semantic intent, not punished by a proxy.'
      : category === 'understanding'
        ? 'Natural conversational input must be interpreted semantically before execution escalation.'
        : category === 'provider'
          ? 'Provider failures must remain distinct from semantic conversation failures.'
          : 'Conversational failures must remain attributable and must not leak internal governance details.'
  return {
    schemaVersion: 1,
    fingerprint: stableFingerprint(input.intent, input.failureReason, input.objective),
    category,
    intent: input.intent,
    failureReason: input.failureReason,
    invariant,
  }
}

export function emitConversationIncident(input: { objective: string; intent: CeoIntent; failureReason: CeoFailureReason }): ConversationIncidentContract {
  const contract = buildConversationIncidentContract(input)
  console.warn('[ceo-conversation-regression]', JSON.stringify(contract))
  return contract
}
