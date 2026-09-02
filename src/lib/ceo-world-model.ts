import type { CanonicalConversationContext } from './ceo-cognitive-conversation'
import type { EvidenceBundle } from './ceo-evidence-bundle'
import type { PersistedConversationRow } from './ceo-context-composer'
import { deriveCeoConversationState } from './ceo-conversation-state'
import { buildWorldStateSnapshot } from './ceo-world-state'

export interface CeoWorldFacet<T> { updatedAt: number; data: T }
export interface CeoWorldModel {
  schemaVersion: 1
  generatedAt: number
  user: CeoWorldFacet<{ goals: string[]; preferences: string[]; constraints: string[] }>
  business: CeoWorldFacet<{ priorities: string[]; projects: string[]; decisions: string[] }>
  system: CeoWorldFacet<{ architecture: string[]; incidents: string[]; deploymentState: string[] }>
  external: CeoWorldFacet<{ evidenceState: 'none' | 'available'; claims: string[]; lastObservedAt?: number }>
  conversation: CeoWorldFacet<{ currentMessage: string; relation: string; openLoops: string[]; recentTurns: number }>
}

function userRows(rows: readonly PersistedConversationRow[] = []): string[] {
  return rows.filter((row) => row.role === 'user').slice(-12).map((row) => row.content.trim()).filter(Boolean)
}
const CONSTRAINT_RE = /\b(?:cannot|can't|avoid|before|without|limited|must|need to)\b/i
const PROJECT_RE = /\b(?:project|business|mission|product|system|operations|revenue|compliance)\b/i

export function buildCeoWorldModel(input: { context: CanonicalConversationContext; priorConversation?: readonly PersistedConversationRow[]; olderConversation?: readonly PersistedConversationRow[]; evidence?: EvidenceBundle }): CeoWorldModel {
  const now = Date.now()
  const priorRows = [...(input.priorConversation ?? []), ...(input.olderConversation ?? [])]
  // The current message is part of what the CEO already knows about this turn, not just
  // established prior conversation -- confirmed by direct testing that omitting it here means a
  // decision or goal stated in the current message (the message that triggered this call in the
  // first place) never shows up in the world model at all, which is the actual bug in the
  // implementation this file replaces.
  const allRows = [...priorRows, { role: 'user' as const, content: input.context.currentMessage, createdAt: now }]
  const userMessages = userRows(allRows)
  // Reuses Phase 5's structured extraction (with real supersession detection) instead of a second,
  // simpler regex-based pass over the same rows -- this is what makes decisions/goals genuinely
  // grounded rather than a duplicate, less capable re-implementation of the same idea.
  const state = deriveCeoConversationState(allRows, input.context.currentMessage)
  const snapshot = buildWorldStateSnapshot(state, allRows)
  const goals = snapshot.goals.filter((record) => record.status === 'active').map((record) => record.text).slice(-5)
  const decisions = snapshot.decisions.filter((record) => record.status === 'active').map((record) => record.text).slice(-5)
  const constraints = userMessages.filter((text) => CONSTRAINT_RE.test(text)).slice(-5)
  const projects = userMessages.filter((text) => PROJECT_RE.test(text)).slice(-5)
  const externalClaims = input.evidence?.claims.slice(0, 20).map((claim) => claim.claim) ?? []
  return {
    schemaVersion: 1,
    generatedAt: now,
    user: { updatedAt: now, data: { goals, preferences: [], constraints } },
    business: { updatedAt: now, data: { priorities: goals.slice(-3), projects, decisions } },
    system: { updatedAt: now, data: { architecture: ['canonical CEO cognitive lifecycle', 'capability-oriented runtime'], incidents: [], deploymentState: ['deployment requires explicit authorization'] } },
    external: { updatedAt: now, data: { evidenceState: externalClaims.length ? 'available' : 'none', claims: externalClaims, lastObservedAt: input.evidence?.freshness.observedAt } },
    conversation: { updatedAt: now, data: { currentMessage: input.context.currentMessage, relation: input.context.speechAct, openLoops: input.context.worldModel.openLoops, recentTurns: allRows.length } },
  }
}

export function renderCeoWorldContext(model: CeoWorldModel): string {
  return JSON.stringify({ user: model.user.data, business: model.business.data, system: model.system.data, external: model.external.data, conversation: model.conversation.data })
}
