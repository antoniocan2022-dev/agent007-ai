import { createHash } from 'node:crypto'
import type { CeoConversationState } from './ceo-conversation-state'

// Item 10 of the "make Agent007 feel like Claude" follow-up plan: ceo-conversation-state.ts already
// derives decisionSignals with real supersession tracking (source-tagged, correction-aware), but that
// state is rebuilt fresh from one conversation's own message history every request -- deriveCeoConversationState
// never sees a different conversationId's messages. A decision made in an old conversation is invisible
// once the user starts a new one, even though the existing lexical/semantic memory pipeline (rankMemories
// in ceo-context-composer.ts) already reads from the Memory table across every conversation. This module
// closes that specific gap: it derives which decision-category Memory rows should exist (current
// decisions, upserted under a stable content-hash key) or be removed (decisions ceo-conversation-state.ts
// has already determined are superseded) -- so a decision becomes genuinely durable (visible in any
// future conversation, and semantically recoverable) without inventing a second, parallel
// decision-detection heuristic. See ceo-episodic-memory-writer.ts for the actual persistence.
//
// Deliberately narrow: only decisions, not the full facts/preferences/commitments/open-loops/lessons
// taxonomy a mature episodic memory would eventually have. Decisions are the highest-value, most clearly
// bounded signal here with existing, tested supersession tracking; the rest would each need their own
// resolution semantics designed and proven before being added the same way.
//
// Deliberately no database import here: kept pure and side-effect-free so this logic is testable
// without Prisma, the same reasoning ceo-memory-embeddings.ts's pure math was kept separate for.
export const EPISODIC_DECISION_CATEGORY = 'decision'
const MAX_EPISODIC_DECISIONS_PER_REQUEST = 6 // matches CeoConversationState.decisions' own cap

export function decisionMemoryKey(text: string): string {
  return `episodic:decision:${createHash('sha256').update(text.trim().toLowerCase()).digest('hex').slice(0, 24)}`
}

export interface EpisodicMemoryUpsert { key: string; value: string; category: string }
export interface EpisodicMemoryDelete { key: string }
export interface EpisodicDecisionWrites { upserts: EpisodicMemoryUpsert[]; deletes: EpisodicMemoryDelete[] }

/**
 * Pure derivation, no I/O: given conversation state, decides which decision Memory rows should
 * exist (current decisions, upserted under a stable content-hash key) and which should be removed
 * (decisions ceo-conversation-state.ts has already determined are superseded).
 *
 * Known, accepted limitation: a decision that ages out of decisionSignals' own most-recent-12 window
 * without ever being explicitly corrected stays in Memory indefinitely (supersession detection only
 * runs over that same recent window). This matches how every other long-lived Memory category in this
 * codebase already behaves -- nothing here does TTL-based cleanup -- and DEFAULT_MEMORY_ITEMS plus
 * relevance-gated selection in rankMemories already bound how much of that accumulation surfaces into
 * any single response.
 */
export function deriveEpisodicDecisionWrites(state: Pick<CeoConversationState, 'decisions' | 'supersededDecisions'>): EpisodicDecisionWrites {
  const upserts = state.decisions.slice(-MAX_EPISODIC_DECISIONS_PER_REQUEST).map((text) => ({ key: decisionMemoryKey(text), value: text, category: EPISODIC_DECISION_CATEGORY }))
  const deletes = state.supersededDecisions.map((text) => ({ key: decisionMemoryKey(text) }))
  return { upserts, deletes }
}
