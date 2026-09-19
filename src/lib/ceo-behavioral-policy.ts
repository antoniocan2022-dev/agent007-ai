import type { CanonicalConversationContext } from './ceo-cognitive-conversation'
import type { CeoIntent, ResponseAction } from './ceo-cognitive-contract'

/** Structurally compatible with the canonical PersistedConversationRow (ceo-context-composer.ts) so safeConversationRows below accepts it directly — widened, not narrowed, to avoid a circular import between the two modules. */
export interface ConversationalHistoryRow { role: string; content: string; createdAt?: Date | string | number }

export const CEO_BEHAVIORAL_MODES = ['business_partner','friend','psychological_insight','technologist','great_thinker','operator','guardian','ceo_curiosity'] as const
export type CeoBehavioralMode = (typeof CEO_BEHAVIORAL_MODES)[number]
export interface CeoBehavioralPolicy { modes: readonly CeoBehavioralMode[]; leadingMode: CeoBehavioralMode; requireCurrentObjectiveMatch: boolean; allowGenericRecovery: boolean; internalArtifactsUserVisible: boolean }

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

// Stage 3 of the CEO Conversation Kernel migration (2026-09-18): classifyCeoBehavioralModes's 8 regex
// checks run independently -- any subset can fire on the same message, and until now the rendered
// prompt just listed whichever ones matched in a fixed, meaning-free array order (CEO_BEHAVIORAL_MODES'
// declaration order), giving the model an unranked grab-bag instead of one clear behavioral stance to
// lead with. This is the arbitration Stage 0's baseline test named as this stage's target: a fixed
// priority order picks exactly one leading mode from whatever matched, so the rendered policy can state
// a primary stance with the rest as supporting context, instead of N modes competing for the model's
// attention with no signal about which should dominate.
//
// Rationale for the order (highest priority first): guardian leads because a safety/evidence/risk
// concern should shape HOW every other active mode gets expressed, never get diluted by one; operator
// next because when the user needs something actually done, that practical need should dominate over
// purely discursive modes; business_partner third as the core professional-default identity for
// substantive business questions; great_thinker/technologist/psychological_insight/ceo_curiosity are
// the analytical/discursive modes, ordered roughly by how directly the user asked for that stance
// (an explicit challenge/first-principles request is a more deliberate ask than an incidental
// psychology or technical keyword match); friend is last because it is already the code's own fallback
// default (see the `!modes.size` branch above) for when nothing more specific matched -- consistent
// with treating it as the least specific, not the least valid, stance.
// Exported (not just used internally) so a test can assert this is exactly a permutation of
// CEO_BEHAVIORAL_MODES -- no mode omitted, none duplicated. That check matters specifically because
// selectLeadingCeoBehavioralMode's fallback default is 'friend': a test that only checks "each mode,
// isolated, is its own leading mode" cannot distinguish 'friend' genuinely being present in this list
// from 'friend' being silently missing and the fallback masking the gap. Direct inspection of this
// array sidesteps that blind spot entirely.
export const CEO_BEHAVIORAL_MODE_PRIORITY: readonly CeoBehavioralMode[] = ['guardian', 'operator', 'business_partner', 'great_thinker', 'technologist', 'psychological_insight', 'ceo_curiosity', 'friend']

// Fresh-audit finding (Phase 2, 2026-09-19): this pure-priority selector was Stage 3's whole arbitration
// mechanism when it shipped, and the Stage 3 comment block above still reads that way in isolation. It
// no longer is: buildCeoBehavioralPolicy (the one real production caller) now goes through the
// context-weighted selectLeadingCeoBehavioralModeFromSignals below instead. This function stays exported
// and correct -- it is still what CEO_BEHAVIORAL_MODE_PRIORITY's tie-break order means in isolation, it
// is the explicit baseline the arbitration tests below compare against to prove the context-weighted
// selection actually changes outcomes, and the Stage 0 baseline test pins its literal export -- but it is
// no longer invoked from the production request path. Read the Stage 3 comment above as "the priority
// order this file establishes," not as "the function the CEO's responses go through today."
export function selectLeadingCeoBehavioralMode(modes: readonly CeoBehavioralMode[]): CeoBehavioralMode {
  return CEO_BEHAVIORAL_MODE_PRIORITY.find((mode) => modes.includes(mode)) ?? 'friend'
}

// Phase 2 of the CEO Conversation Kernel migration (external audit, 2026-09-19), issue 2:
// selectLeadingCeoBehavioralMode above is pure static priority -- guardian always beats operator always
// beats business_partner, regardless of how strongly (or weakly) each one actually matched this
// specific message. The audit's fair criticism: that is not genuine capability selection, it is a fixed
// ranking applied uniformly to whatever classifyCeoBehavioralModes' 8 independent regexes happened to
// match, including a mode that only matched on one incidental keyword mention.
//
// classifyCeoBehavioralModeSignals tags each matched mode with whether the match came from an EXPLICIT
// signal already present in the turn's own execution contract (intent/responseAction -- values the CEO
// pipeline itself decided, not a regex guess) or only from an incidental keyword in the message text.
// Deliberately reuses classifyCeoBehavioralModes for the underlying "which modes matched" computation
// (never reimplements it) so the two functions can never disagree about which modes are active --
// exactly the kind of duplicated-logic drift this migration exists to remove.
const BUSINESS_PARTNER_HARD_INTENTS = new Set<CeoIntent>(['decision', 'mission_action'])
function isHardModeSignal(mode: CeoBehavioralMode, input: { intent: CeoIntent; responseAction: ResponseAction }): boolean {
  if (mode === 'business_partner') return BUSINESS_PARTNER_HARD_INTENTS.has(input.intent)
  if (mode === 'operator') return input.responseAction === 'execute' || input.responseAction === 'verify'
  if (mode === 'guardian') return input.intent === 'research' || input.responseAction === 'verify'
  return false
}

export interface CeoBehavioralModeSignal { mode: CeoBehavioralMode; hard: boolean }

export function classifyCeoBehavioralModeSignals(input: { context?: CanonicalConversationContext; intent: CeoIntent; responseAction: ResponseAction; currentMessage: string }): readonly CeoBehavioralModeSignal[] {
  return classifyCeoBehavioralModes(input).map((mode) => ({ mode, hard: isHardModeSignal(mode, input) }))
}

// guardian is a deliberate, unconditional exception to hard/soft weighting: a safety/evidence/risk
// concern should shape HOW every other active mode gets expressed even when it only matched on an
// incidental keyword (see CEO_BEHAVIORAL_MODE_PRIORITY's own rationale comment above) -- weakening
// guardian's precedence to "only when hard-matched" would regress the exact safety-first behavior
// Stage 3's own arbitration test pins (a message that mentions "risk" in passing while also asking to
// "execute" something must still lead with guardian, not operator). Among every OTHER mode, a hard
// (explicit, contract-driven) signal now outranks a merely soft (keyword-only) one regardless of
// CEO_BEHAVIORAL_MODE_PRIORITY's order; CEO_BEHAVIORAL_MODE_PRIORITY itself remains the tie-breaker
// within whichever pool (hard or, if none, soft) actually has a match -- so a single-mode message still
// resolves exactly as selectLeadingCeoBehavioralMode already would, and this only ever changes the
// outcome when a genuinely explicit signal and a genuinely incidental one compete.
export function selectLeadingCeoBehavioralModeFromSignals(signals: readonly CeoBehavioralModeSignal[]): CeoBehavioralMode {
  if (signals.some((signal) => signal.mode === 'guardian')) return 'guardian'
  const hardModes = signals.filter((signal) => signal.hard).map((signal) => signal.mode)
  const pool = hardModes.length ? hardModes : signals.map((signal) => signal.mode)
  return CEO_BEHAVIORAL_MODE_PRIORITY.find((mode) => pool.includes(mode)) ?? 'friend'
}

export function buildCeoBehavioralPolicy(input: { context?: CanonicalConversationContext; intent: CeoIntent; responseAction: ResponseAction; currentMessage: string }): CeoBehavioralPolicy {
  const signals = classifyCeoBehavioralModeSignals(input)
  const modes = signals.map((signal) => signal.mode)
  return { modes, leadingMode: selectLeadingCeoBehavioralModeFromSignals(signals), requireCurrentObjectiveMatch: true, allowGenericRecovery: false, internalArtifactsUserVisible: false }
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
  const supportingModes = policy.modes.filter((mode) => mode !== policy.leadingMode)
  return ['CEO BEHAVIORAL POLICY (authoritative, internal):', `Primary executive mode: ${policy.leadingMode}`, `Supporting modes: ${supportingModes.join(', ') || 'none'}`, `Current-objective match required: ${policy.requireCurrentObjectiveMatch ? 'yes' : 'no'}`, `Generic recovery allowed: ${policy.allowGenericRecovery ? 'yes' : 'no'}`, `Internal artifacts user-visible: ${policy.internalArtifactsUserVisible ? 'yes' : 'no'}`, 'Policy: lead the response with the primary executive mode\'s stance; let supporting modes inform tone or content without diluting or contradicting it. Preserve the current request as the authoritative objective; use prior context only when it helps answer that current request; never substitute a prior objective for the current one.'].join('\n')
}
