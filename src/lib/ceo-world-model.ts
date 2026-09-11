import type { CanonicalConversationContext } from './ceo-cognitive-conversation'
import type { EvidenceBundle } from './ceo-evidence-bundle'
import type { PersistedConversationRow } from './ceo-context-composer'
import { deriveCeoConversationState, safeConversationRows } from './ceo-conversation-state'
import { buildWorldStateSnapshot } from './ceo-world-state'
import { getCanonicalProviderTelemetry } from './canonical-llm-router'
import { CEO_CAPABILITY_ARCHITECTURE } from './ceo-capability-architecture'
import { EMPTY_PARTNER_INTELLIGENCE, type PartnerIntelligenceSummary } from './ceo-partner-intelligence'

export interface CeoWorldFacet<T> { updatedAt: number; data: T }
export interface CeoWorldModel {
  schemaVersion: 1
  generatedAt: number
  user: CeoWorldFacet<{ goals: string[]; preferences: string[]; constraints: string[] }>
  business: CeoWorldFacet<{ priorities: string[]; projects: string[]; decisions: string[] }>
  system: CeoWorldFacet<{ architecture: string[]; incidents: string[]; deploymentState: string[] }>
  external: CeoWorldFacet<{ evidenceState: 'none' | 'available'; claims: string[]; lastObservedAt?: number }>
  conversation: CeoWorldFacet<{ currentMessage: string; relation: string; openLoops: string[]; recentTurns: number }>
  partners: CeoWorldFacet<PartnerIntelligenceSummary>
}

function userRows(rows: readonly PersistedConversationRow[] = []): string[] {
  return safeConversationRows(rows).filter((row) => row.role === 'user').slice(-12).map((row) => row.content.trim()).filter(Boolean)
}
const CONSTRAINT_RE = /\b(?:cannot|can't|avoid|before|without|limited|must|need to)\b/i
const PROJECT_RE = /\b(?:project|business|mission|product|system|operations|revenue|compliance)\b/i
const PREFERENCE_RE = /\b(?:prefer|would rather|i like|i(?:'d| would) like|i want(?:ed)? (?:it|things|this) to|please always|please never|please don't|don't want|from now on|going forward|instead of)\b/i

// Real, live signal (circuit-breaker + health-score state from canonical-llm-router.ts), not
// a static claim -- so "architecture"/"incidents"/"deploymentState" actually change when the
// system's real provider health changes, instead of always rendering the same filler strings.
function systemFacetData(): { architecture: string[]; incidents: string[]; deploymentState: string[] } {
  const telemetry = getCanonicalProviderTelemetry()
  const configuredLabels = telemetry.providers.filter((provider) => provider.configured).map((provider) => provider.label)
  const architecture = [
    `${telemetry.configuredCount}/${telemetry.providerCount} LLM providers configured${configuredLabels.length ? ` (${configuredLabels.join(', ')})` : ''}`,
    `${CEO_CAPABILITY_ARCHITECTURE.length} governed capability domains (${CEO_CAPABILITY_ARCHITECTURE.map((capability) => capability.id).join(', ')})`,
  ]
  const incidents = telemetry.providers
    .filter((provider) => provider.configured && provider.status !== 'healthy')
    .map((provider) => `${provider.label} provider is ${provider.status}`)
  const deploymentState = [`${telemetry.availableCount}/${telemetry.configuredCount} configured providers currently available`]
  return { architecture, incidents, deploymentState }
}

export function buildCeoWorldModel(input: { context: CanonicalConversationContext; priorConversation?: readonly PersistedConversationRow[]; olderConversation?: readonly PersistedConversationRow[]; evidence?: EvidenceBundle; partners?: PartnerIntelligenceSummary }): CeoWorldModel {
  const now = Date.now()
  const priorRows = [...(input.priorConversation ?? []), ...(input.olderConversation ?? [])]
  const safePriorRows = safeConversationRows(priorRows)
  // The current message is part of what the CEO already knows about this turn, not just
  // established prior conversation. Add it once to the same canonical safety boundary.
  const allRows = safeConversationRows([...safePriorRows, { role: 'user' as const, content: input.context.currentMessage, createdAt: now }])
  const userMessages = userRows(allRows)
  // Reuses the conversation-state extraction rather than maintaining a second thread/goal model.
  const state = deriveCeoConversationState(allRows, input.context.currentMessage)
  const snapshot = buildWorldStateSnapshot(state, allRows)
  const goals = snapshot.goals.filter((record) => record.status === 'active').map((record) => record.text).slice(-5)
  const decisions = snapshot.decisions.filter((record) => record.status === 'active').map((record) => record.text).slice(-5)
  const constraints = userMessages.filter((text) => CONSTRAINT_RE.test(text)).slice(-5)
  const projects = userMessages.filter((text) => PROJECT_RE.test(text)).slice(-5)
  const preferences = userMessages.filter((text) => PREFERENCE_RE.test(text)).slice(-5)
  const externalClaims = input.evidence?.claims.slice(0, 20).map((claim) => claim.claim) ?? []
  return {
    schemaVersion: 1,
    generatedAt: now,
    user: { updatedAt: now, data: { goals, preferences, constraints } },
    business: { updatedAt: now, data: { priorities: goals.slice(-3), projects, decisions } },
    system: { updatedAt: now, data: systemFacetData() },
    external: { updatedAt: now, data: { evidenceState: externalClaims.length ? 'available' : 'none', claims: externalClaims, lastObservedAt: input.evidence?.freshness.observedAt } },
    conversation: { updatedAt: now, data: { currentMessage: input.context.currentMessage, relation: input.context.speechAct, openLoops: input.context.worldModel.openLoops, recentTurns: allRows.length } },
    partners: { updatedAt: now, data: input.partners ?? EMPTY_PARTNER_INTELLIGENCE },
  }
}

export function renderCeoWorldContext(model: CeoWorldModel): string {
  return JSON.stringify({ user: model.user.data, business: model.business.data, system: model.system.data, external: model.external.data, conversation: model.conversation.data, partners: model.partners.data })
}
