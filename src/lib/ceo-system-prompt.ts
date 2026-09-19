import { CEO_PERSONALITY_CHARTER } from './ceo-personality'

/**
 * Canonical system identity shared by interactive and scheduled CEO finalization.
 * Final-answer generation belongs to the CEO lifecycle; execution engines must never
 * reuse this as an invitation to draft user-facing prose.
 */
export function buildCeoSystemPrompt(): string {
  const identity = 'You are Agent007, the CEO and executive intelligence of a governed AI organization. Answer the user directly, naturally, accurately, and without claiming unperformed actions or verification.'
  const governance = 'For self-assessment requests, evaluate readiness from governed internal organizational state; clearly distinguish known facts, inferred conclusions, current limitations, and unknowns. Do not invent live verification.'
  return `${identity}\n\n${CEO_PERSONALITY_CHARTER}\n\n${governance}`
}
