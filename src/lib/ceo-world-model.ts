import type { CanonicalConversationContext } from './ceo-cognitive-conversation'
import type { EvidenceBundle } from './ceo-evidence-bundle'
import type { PersistedConversationRow } from './ceo-context-composer'

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

function userRows(rows: readonly PersistedConversationRow[] = []): string[] { return rows.filter((row) => row.role === 'user').slice(-12).map((row) => row.content.trim()).filter(Boolean) }
export function buildCeoWorldModel(input: { context: CanonicalConversationContext; priorConversation?: readonly PersistedConversationRow[]; olderConversation?: readonly PersistedConversationRow[]; evidence?: EvidenceBundle }): CeoWorldModel {
  const now = Date.now()
  const rows = [...(input.priorConversation ?? []), ...(input.olderConversation ?? [])]
  const userMessages = userRows(rows)
  const contextText = `${input.context.currentMessage} ${input.context.meaning}`
  const goals = userMessages.filter((text) => /\b(?:goal|priorit(?:y|ize)|focus|objective|build|grow|launch)\b/i.test(text)).slice(-5)
  const constraints = userMessages.filter((text) => /\b(?:cannot|can't|avoid|before|without|limited|must|need to)\b/i.test(text)).slice(-5)
  const projects = userMessages.filter((text) => /\b(?:project|business|mission|product|system|operations|revenue|compliance)\b/i.test(text)).slice(-5)
  const decisions = userMessages.filter((text) => /\b(?:decide|decision|agreed|prefer|choose|priorit(?:y|ize)|ruled out)\b/i.test(text)).slice(-5)
  const externalClaims = input.evidence?.claims.slice(0, 20).map((claim) => claim.claim) ?? []
  return {
    schemaVersion: 1,
    generatedAt: now,
    user: { updatedAt: now, data: { goals, preferences: [], constraints } },
    business: { updatedAt: now, data: { priorities: goals.slice(-3), projects, decisions } },
    system: { updatedAt: now, data: { architecture: ['canonical CEO cognitive lifecycle', 'capability-oriented runtime'], incidents: [], deploymentState: ['deployment requires explicit authorization'] } },
    external: { updatedAt: now, data: { evidenceState: externalClaims.length ? 'available' : 'none', claims: externalClaims, lastObservedAt: input.evidence?.freshness.observedAt } },
    conversation: { updatedAt: now, data: { currentMessage: input.context.currentMessage, relation: input.context.speechAct, openLoops: input.context.worldModel.openLoops, recentTurns: rows.length } },
  }
}

export function renderCeoWorldContext(model: CeoWorldModel): string {
  return JSON.stringify({ user: model.user.data, business: model.business.data, system: model.system.data, external: model.external.data, conversation: model.conversation.data })
}