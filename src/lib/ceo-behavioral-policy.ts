import type { CanonicalConversationContext } from './ceo-cognitive-conversation'
import type { CeoIntent, ResponseAction } from './ceo-cognitive-contract'

/** Structurally compatible with the canonical PersistedConversationRow (ceo-context-composer.ts) so safeConversationRows below accepts it directly — widened, not narrowed, to avoid a circular import between the two modules. */
export interface ConversationalHistoryRow { role: string; content: string; createdAt?: Date | string | number }

export const CEO_BEHAVIORAL_MODES = ['business_partner','friend','psychological_insight','technologist','great_thinker','operator','guardian','ceo_curiosity'] as const
export type CeoBehavioralMode = (typeof CEO_BEHAVIORAL_MODES)[number]
export interface CeoBehavioralPolicy { modes: readonly CeoBehavioralMode[]; requireCurrentObjectiveMatch: boolean; allowGenericRecovery: boolean; internalArtifactsUserVisible: boolean }

export function classifyCeoBehavioralModes(input: { context?: CanonicalConversationContext; intent: CeoIntent; responseAction: ResponseAction; currentMessage: string }): CeoBehavioralMode[] {
  const text = input.currentMessage.toLowerCase(), modes = new Set<CeoBehavioralMode>()
  if (/\b(?:business|revenue|customer|market|strategy|strategic|profit|company|venture|growth|priority|objective)\b/.test(text) || input.intent === 'decision' || input.intent === 'mission_action') modes.add('business_partner')
  if (/\b(?:me|myself|i feel|i’m|i'm|i am|honest|personally|naturally|friend|pushing too hard|exhausted|frustrated)\b/.test(text)) modes.add('friend')
  if (/\b(?:psycholog[a-z]*|behavior[a-z]*|behavio[u]?r[a-z]*|motivation|bias|pattern|decision making|decision-making|emotion|habit)\b/.test(text)) modes.add('psychological_insight')
  if (/\b(?:architecture|technical|technolog[a-z]*|code|software|system|runtime|repository|module|integration|canonical|bug|error|developer|implementation)\b/.test(text) || input.intent === 'analysis' && /technical|architecture|code|system/i.test(text)) modes.add('technologist')
  if (/\b(?:first principles|fundamental|fundamentally|deeper|deep|philosoph[a-z]*|abstraction|counterargument|counter-argument|challenge|strongest case|why)\b/.test(text)) modes.add('great_thinker')
  if (input.responseAction === 'execute' || input.responseAction === 'verify' || /\b(?:operational|operate|execution|execute|checklist|dependencies|rollback|procedure|steps|workflow)\b/.test(text)) modes.add('operator')
  if (input.intent === 'research' || input.responseAction === 'verify' || /\b(?:risk|danger|safe|safety|evidence|unsupported|refuse|guardian|compliance|high-risk|high risk)\b/.test(text)) modes.add('guardian')
  if (/\b(?:what should you ask|important question|what do we not know|unknown|evidence would you need|hypothesis|curious|curiosity|what question)\b/.test(text)) modes.add('ceo_curiosity')
  if (!modes.size) modes.add(input.intent === 'opinion' || input.responseAction === 'challenge' ? 'business_partner' : 'friend')
  return CEO_BEHAVIORAL_MODES.filter((mode) => modes.has(mode))
}

export function buildCeoBehavioralPolicy(input: { context?: CanonicalConversationContext; intent: CeoIntent; responseAction: ResponseAction; currentMessage: string }): CeoBehavioralPolicy {
  return { modes: classifyCeoBehavioralModes(input), requireCurrentObjectiveMatch: true, allowGenericRecovery: false, internalArtifactsUserVisible: false }
}

export const CEO_INTERNAL_ARTIFACT_TOKENS = ['continuous_loop_trace','evidence_trace','quality_trace','routing_trace','ceo_recommendation','ceo_recommendation_action','ceo_observed_outcome','ceo_conversation_incident','ceo_incident_regression_candidate','architecture_business_outcome','mission_telemetry','runtime_telemetry','ceo_runtime_metrics','provider_telemetry','governed_evolution_cycle'] as const
const INTERNAL_MARKER_PATTERNS = CEO_INTERNAL_ARTIFACT_TOKENS.join('|')
// Trailing boundary is `(?:\b|_)`, not just `\b`: a real persisted key appends an id directly
// after the token with an underscore (e.g. `governed_evolution_cycle_123`), and `_` is a word
// character, so a plain `\b` never fires there -- the token would silently evade detection in
// exactly the shape it actually appears in stored data.
const INTERNAL_ARTIFACT_TOKEN_RE = new RegExp(`\\b(?:${INTERNAL_MARKER_PATTERNS})(?:\\b|_)`, 'i')
export function containsInternalArtifactToken(content: string): boolean { return INTERNAL_ARTIFACT_TOKEN_RE.test(content) }
export function assertUserFacingText(content: string): string { const value = content.trim(); return value && !containsInternalArtifactToken(value) ? value : '' }
export function safeConversationRows<T extends ConversationalHistoryRow>(rows: readonly T[] = []): T[] { return rows.filter((row) => row.role === 'user' || (row.role === 'assistant' && Boolean(row.content.trim()) && !containsInternalArtifactToken(row.content))) }

export function renderCeoBehavioralPolicy(policy: CeoBehavioralPolicy): string {
  return ['CEO BEHAVIORAL POLICY (authoritative, internal):',`Executive modes: ${policy.modes.join(', ')}`,`Current-objective match required: ${policy.requireCurrentObjectiveMatch ? 'yes' : 'no'}`,`Generic recovery allowed: ${policy.allowGenericRecovery ? 'yes' : 'no'}`,`Internal artifacts user-visible: ${policy.internalArtifactsUserVisible ? 'yes' : 'no'}`,'Policy: preserve the current request as the authoritative objective; use prior context only when it helps answer that current request; never substitute a prior objective for the current one.'].join('\n')
}
