import type { PersistedConversationRow, PersistedMemoryRow } from './ceo-context-composer'
import type { CeoConversationState, ConversationReference } from './ceo-conversation-state'
import { buildConversationDecisionContract, renderConversationDecisionContract, type ConversationDecisionContract } from './ceo-conversation-decision-contract'
import type { InstructionWindowExtractionMethod, SemanticUncertainty } from './ceo-cognitive-contract'
import { extractInstructionWindowDetails } from './ceo-cognitive-contract'
import { isCommitmentStatement, isCorrectionRequest, isContinuationOrRestatementRequest } from './ceo-conversational-signals'
import { hasExplicitSelfAssessmentPhrase, SELF_REFERENCE_RE } from './ceo-self-reflection'

export type CognitiveDepth = 'direct' | 'contextual' | 'deep' | 'strategic'
export type ReferenceScope = 'none' | 'same_turn' | 'cross_turn' | 'mixed'
export type SemanticIntentHint = 'conversation' | 'self_assessment' | 'analysis' | 'decision' | 'research' | 'action' | 'unknown'
export type SemanticSpeechAct = 'social' | 'question' | 'proposition' | 'continuation' | 'correction' | 'request' | 'unknown'
export interface SemanticInterpretation { schemaVersion: 1; meaning: string; confidence: number; uncertainty: SemanticUncertainty[]; source: 'deterministic' | 'model_assisted' | 'hybrid'; suggestedIntent?: SemanticIntentHint; suggestedSpeechAct?: SemanticSpeechAct; suggestedCognitiveDepth?: CognitiveDepth }
export type RequestedOperation = 'conversation' | 'document_comprehension' | 'document_summary' | 'document_critique' | 'document_compare' | 'document_extract' | 'analysis' | 'decision' | 'research' | 'action' | 'self_assessment'
export interface CeoTurnEnvelope {
  schemaVersion: 1
  instruction: { text: string; extractionMethod: InstructionWindowExtractionMethod }
  sourceMaterial: { present: boolean; length: number }
  selfAssessmentRequested: boolean
  requestedOperation: RequestedOperation
}
export interface ConversationalWorldModel { schemaVersion: 1; workingTopic: string; subtopics: string[]; userGoals: string[]; decisions: string[]; commitments: string[]; openLoops: string[]; activeThreads: string[]; importantEntities: string[]; recentCorrections: string[]; durableMemoryKeys: string[] }
// Recommendation 1 (2026-09-20): `instruction`/`sourceLength` make the canonical, single per-turn
// build (this function is the one reuse-guarded construction site -- see composeCeoContext's own
// comment on that discipline) the ONE place extractInstructionWindow's result is computed, instead of
// every downstream keyword classifier (actionFor, shouldAssist/interpretCeoSemantics, ceo-pre-router.ts)
// independently recomputing it from a message that isn't always even byte-identical across call sites
// (ceo-pre-router.ts's own `text` used to whitespace-collapse newlines before windowing, silently
// disabling the lead-in-phrase branch that only ever needs a real newline to fire). Consumers with a
// canonical context now read `.instruction` directly; anything without one (tests, offline tooling)
// keeps calling extractInstructionWindow itself exactly as before -- this is additive, not a narrowing.
export interface CanonicalConversationContext { schemaVersion: 1; currentMessage: string; instruction: string; sourceLength: number; turnEnvelope: CeoTurnEnvelope; meaning: string; semanticInterpretation: SemanticInterpretation; intentHint: SemanticIntentHint; speechAct: SemanticSpeechAct; cognitiveDepth: CognitiveDepth; referenceScope: ReferenceScope; references: readonly ConversationReference[]; worldModel: ConversationalWorldModel; state: CeoConversationState }
// Long-document incident (2026-09-19): mirrors the identical fix in ceo-context-composer.ts's normalize()
// -- previously collapsed all whitespace (including newlines) to a single space, flattening a pasted
// document's headings/lists/paragraph breaks/code fences before deterministicMeaning/classifyCognitiveDepth
// ever reasoned over currentMessage. Now preserves line breaks and paragraph boundaries.
function normalize(value: string): string { return value.replace(/[ \t]+/g, ' ').replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{3,}/g, '\n\n').trim() }
function unique(items: readonly string[], max = 8): string[] { return [...new Set(items.map(normalize).filter(Boolean))].slice(-max) }
// This function used to carry its own, independently-maintained regex for recognizing an explicit
// self-assessment phrase, which had drifted out of sync with ceo-self-reflection.ts's canonical
// EXPLICIT_SELF_ASSESSMENT_RE (this one recognized "is Agent007 ready"-style phrasing that the
// canonical one didn't gate the same way, and the canonical one recognized "self-assessment"/
// "self-evaluation"/etc that this one didn't) -- exactly the kind of duplicate-logic drift that let a
// real self-assessment request go misclassified as 'analysis' in production (2026-09-12). This now
// calls the shared, single-sourced hasExplicitSelfAssessmentPhrase() for that literal-phrase check
// instead of re-implementing it. It deliberately does NOT call the fuller classifyCeoSelfReflection
// (which also matches bare capability/readiness words like "weakness" or "ready") -- that broader net
// is right for ceo-pre-router.ts's routing decision but too permissive here, where a bare capability
// word inside an incomplete, unrelated sentence fragment should not by itself commit to self_assessment
// intent (see tests/ceo-conversation-behavioral.test.ts's incomplete-message cases).
// Long-document incident (2026-09-19): scans the bounded instruction window (see
// extractInstructionWindow), not the raw message -- this function used to test the entire pasted message
// including any long document, so a paste that used words like "deploy"/"verify"/"recommend"/"analyze"
// anywhere in its body (extremely common in ordinary prose) could set the wrong intentHint before
// actionFor() (ceo-conversation-decision-contract.ts) ever got a chance to classify the response action --
// its own per-branch keyword scoping fix can't correct for having entered the wrong branch to begin with.
// Production incident (2026-09-20): the self-assessment check used to be the one exception, deliberately
// left scanning the full message on the reasoning that the phrasing was "rare... unlikely to appear
// misleadingly inside pasted source material." A real user report falsified that: a genuine "give me a
// deep comprehension of this document" request over a long business report was hijacked into a canned
// self-assessment response, because the report's own body used ordinary phrases like "readiness
// assessment"/"capability assessment" (extremely common section headers in real business/strategy
// documents) -- and self_assessment is the one intent this codebase treats as AUTHORITATIVE, unoverridable
// even by a confident model-assisted suggestion (see deterministicIntentIsAuthoritative below), so once
// this false-positived there was no recovery path downstream. Windowed exactly like every other branch
// here: a short, explicit self-assessment request (the common case) is fully captured either way
// (extractInstructionWindow returns short messages unchanged), and a genuinely long self-assessment ask
// still matches as long as the phrase sits in the message's own head or tail, not buried mid-document.
// Follow-up fix (2026-09-20): windowing alone was not sufficient. "readiness assessment"/"system
// readiness"/"capability assessment" were bare substring matches with no self-reference requirement at
// all -- unlike every other alternative here (all embed "you"/"agent007"/"the system" literally) and
// unlike ceo-self-reflection.ts's own READINESS_RE/CAPABILITY_RE (which require proximity to a
// self-reference word). A report's own "Section 5: Technology Capability Assessment" heading sitting in
// the message's own head or tail -- an extremely common place for such a section, e.g. a closing
// "Recommendations & Readiness Assessment" section -- would still false-positive post-windowing. Now
// requires genuine self-reference (you/your/agent007/ceo/the system/the agent/the assistant) to appear
// somewhere in the same window before these three bare business terms can commit to self_assessment,
// reusing ceo-self-reflection.ts's own canonical word list instead of a second, driftable copy.
// Contract-consistency gate (2026-09-20, Source Authority initiative Phase 1): self_assessment is
// AUTHORITATIVE -- once it wins, the turn takes the bounded, tool-free self-assessment fast lane and
// Phase 3 hierarchical document comprehension never runs, silently discarding any pasted source material
// the same message also carried. That's an acceptable trade when the user's own words unambiguously ask
// for a self-assessment; it's not when `sourceMaterialPresent` (the message was long enough that
// extractInstructionWindow actually trimmed it) and the signal is only an implicit one ("are you ready",
// a proximity-gated "capability assessment", etc.) -- the safer default is to let the turn fall through
// to analysis/conversation, which still SEES the source material, rather than silently drop it under an
// inferred self-assessment reading. Only hasExplicitSelfAssessmentPhrase (an unambiguous "self-
// assessment"/"self-evaluation"/etc. request) can win self_assessment once source material is present;
// this does not change behavior for the common case (a short message IS the instruction --
// sourceMaterialPresent is false whenever extractInstructionWindow returns it unchanged).
function userIntentHint(instructionWindow: string, sourceMaterialPresent: boolean): SemanticIntentHint {
  const text = instructionWindow.toLowerCase()
  if (hasExplicitSelfAssessmentPhrase(instructionWindow)) return 'self_assessment'
  if (!sourceMaterialPresent && /\b(?:are\s+(?:you|agent007|the\s+system)\s+ready|is\s+(?:agent007|the\s+system)\s+ready|assess\s+(?:yourself|agent007|the\s+system)|evaluate\s+(?:your|the\s+system['’]?s)\s+(?:capabilities|readiness|maturity)|what\s+are\s+you\s+(?:capable|ready)\s+of|how\s+(?:are|is)\s+(?:you|agent007|the\s+system)\s+(?:doing|performing))\b/i.test(text)) return 'self_assessment'
  if (!sourceMaterialPresent && SELF_REFERENCE_RE.test(instructionWindow) && /\b(?:readiness\s+assessment|system\s+readiness|capability\s+assessment)\b/i.test(text)) return 'self_assessment'
  if (/\b(?:deploy|publish|ship|execute|send|create|delete|update|schedule)\b/.test(text)) return 'action'
  if (/\b(?:research|look\s+up|find\s+out|verify|fact[- ]check)\b/.test(text)) return 'research'
  if (/\b(?:choose|pick|decide|recommend|should(?:\s+i|\s+we)?\b|priority|prioritize)\b/.test(text)) return 'decision'
  if (/\b(?:analy[sz]e|analysis|compare|assess|evaluate|diagnose|strategy|strategic|architecture)\b/.test(text)) return 'analysis'
  return 'conversation'
}
// Deep-audit fix (2026-09-13): this used to hand-roll its own narrow continue/go-back/return-to/
// same-as-before check instead of also recognizing the canonical isContinuationOrRestatementRequest --
// a 5th independently-drifting copy of the exact concept that function was consolidated to fix (see its
// own comment in ceo-conversational-signals.ts): "recap", "tell me in your own words", "what about the
// second option" were all recognized by the canonical check but missed here. Added as an extra OR
// rather than a replacement for the original bare keyword check: the canonical function is
// start-anchored to specific phrases, so "No, let's continue with the current plan." (an existing,
// still-passing test case -- "continue" appearing after a leading "No," that isn't a recognized filler)
// would lose its 'continuation' classification if the original unanchored bare-keyword check were
// removed. Keeping both closes the canonical-recognition gap purely additively, with no narrowing.
function speechAct(message: string): SemanticSpeechAct { const text = message.trim(); if (isCorrectionRequest(text)) return 'correction'; if (/^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening)|thanks?|thank\s+you|ok(?:ay)?|great|perfect)[\s!.?]*$/i.test(text)) return 'social'; if (/\b(?:continue|go\s+back|return\s+to|same\s+as\s+before)\b/i.test(text) || /\bthe\s+(?:first|second|third|last|other)\b/i.test(text) || isContinuationOrRestatementRequest(text)) return 'continuation'; if (text.endsWith('?')) return 'question'; if (/\b(?:please|let's|lets|i want|i need|can you|could you|would you)\b/i.test(text)) return 'request'; if (text.length >= 12) return 'proposition'; return 'unknown' }
function hasExplicitDepthSignal(message: string): boolean { return /\b(?:deep|deeply|comprehensive|comprehensively|thorough|thoroughly|in[- ]depth|stress[- ]test|root\s+cause|architecture|trade[- ]offs?|strategy|strategic|long[- ]term)\b/i.test(message) }
// Found investigating a real production truncation: "Which should we prioritize first: revenue
// recovery or improving the operations foundation?" classified as 'contextual' depth (not 'strategic')
// because no strategic-depth keyword matched, even though it's exactly the kind of executive trade-off
// question this system is built to answer at length. canonical-llm-router.ts's explicitPlan() only
// grants the 8000-token 'deep' lane when depth is classified 'strategic'; misclassifying it here caps
// the token budget far below what the model's own multi-section executive-reasoning answer needed,
// truncating it mid-sentence. Matches only the decisive verb form (prioritize/prioritise, not the bare
// noun priority/priorities) -- a message that merely lists or reports priorities ("I think these are
// the three priorities...") is a direct statement, not a request to weigh and rank options, and an
// existing test already calibrates that distinction; conflating the two would have reopened it.
// Deep-audit fix (2026-09-13): classifyCognitiveDepth and classifyCognitiveDepthFromMessages had
// independently drifted on this exact trigger regex -- the former missed 'assess' and only matched
// singular 'trade-off' (word-boundary fails on 'trade-offs'), while the latter had both. Since
// canonical-llm-router.ts uses classifyCognitiveDepthFromMessages to gate its 8000-token "deep" lane,
// a message like "let's assess the situation with our vendor contract" could get the router's strategic
// token budget while this file's own context.cognitiveDepth (read by registerFor() in
// ceo-conversation-decision-contract.ts) reported a lower depth for the identical message. Single-
// sourced here; each function keeps its own turn-count threshold untouched (state.turnCount and
// priorTurnCount come from genuinely different counting bases at their respective call sites, so that
// comparison is left alone rather than guessed at).
const STRATEGIC_DEPTH_SIGNAL_RE = /\b(?:decide|decision|recommend|priorit(?:is|iz)e\w*|trade[- ]offs?|strategy|strategic|root\s+cause|architecture|compare|evaluate|assess)\b/i
export function classifyCognitiveDepth(message: string, state: CeoConversationState, referenceCount: number): CognitiveDepth { const text = message.toLowerCase(); if (STRATEGIC_DEPTH_SIGNAL_RE.test(text) || hasExplicitDepthSignal(message)) return 'strategic'; if (state.turnCount >= 10 || referenceCount >= 2) return 'deep'; if (referenceCount > 0 || state.turnCount > 2 || /\b(?:why|how|which|what)\b/.test(text)) return 'contextual'; return 'direct' }
export function classifyCognitiveDepthFromMessages(message: string, priorTurnCount: number, referenceCount: number): CognitiveDepth { const safeTurns = Math.max(0, Math.floor(priorTurnCount)); const text = message.trim(); if (STRATEGIC_DEPTH_SIGNAL_RE.test(text) || hasExplicitDepthSignal(text)) return 'strategic'; if (safeTurns >= 10 || referenceCount >= 2) return 'deep'; if (referenceCount > 0 || safeTurns >= 2 || /\b(?:why|how|which|what)\b/i.test(text)) return 'contextual'; return 'direct' }
function referenceScope(references: readonly ConversationReference[], currentMessage: string): ReferenceScope { if (!references.length) return 'none'; const hasSameTurn = /\b(?:it|they|them|this|that|these|those)\b/i.test(currentMessage) && /\b(?:and|,|both|each)\b/i.test(currentMessage); const hasCrossTurn = references.some((reference) => Boolean(reference.resolvedText)); if (hasSameTurn && hasCrossTurn) return 'mixed'; return hasSameTurn ? 'same_turn' : 'cross_turn' }
function deterministicMeaning(message: string, state: CeoConversationState, references: readonly ConversationReference[]): string { const current = normalize(message); const resolved = references.find((reference) => reference.resolvedText && !reference.ambiguous); if (resolved) return `${current} [refers to: ${normalize(resolved.resolvedText ?? '')}]`; if (state.topic) return `${current} [conversation topic: ${normalize(state.topic)}]`; return current }
function buildWorldModel(state: CeoConversationState, memories: readonly PersistedMemoryRow[], rows: readonly PersistedConversationRow[]): ConversationalWorldModel { return { schemaVersion: 1, workingTopic: state.topic, subtopics: unique([...state.topicCandidates.slice(0, 8), ...state.entities], 10), userGoals: unique(state.recentUserGoals, 8), decisions: unique(state.decisions, 8), commitments: unique(rows.filter((row) => row.role === 'user' && isCommitmentStatement(row.content)).map((row) => row.content), 6), openLoops: unique(state.unresolvedQuestions, 6), activeThreads: state.threads.filter((thread) => thread.status === 'active' || thread.status === 'paused').slice(-6).map((thread) => `${thread.title} [${thread.status}]`), importantEntities: unique(state.entities, 12), recentCorrections: unique(state.recentCorrections, 6), durableMemoryKeys: memories.slice(0, 8).map((memory) => memory.key) } }
function sanitizeSuggestedIntent(value: unknown): SemanticIntentHint | undefined { return value === 'conversation' || value === 'self_assessment' || value === 'analysis' || value === 'decision' || value === 'research' || value === 'action' || value === 'unknown' ? value : undefined }
function sanitizeSuggestedSpeechAct(value: unknown): SemanticSpeechAct | undefined { return value === 'social' || value === 'question' || value === 'proposition' || value === 'continuation' || value === 'correction' || value === 'request' || value === 'unknown' ? value : undefined }
function sanitizeSuggestedDepth(value: unknown): CognitiveDepth | undefined { return value === 'direct' || value === 'contextual' || value === 'deep' || value === 'strategic' ? value : undefined }

function requestedOperationFromIntent(intent: SemanticIntentHint): RequestedOperation {
  if (intent === 'self_assessment') return 'self_assessment'
  if (intent === 'analysis') return 'analysis'
  if (intent === 'decision') return 'decision'
  if (intent === 'research') return 'research'
  if (intent === 'action') return 'action'
  return 'conversation'
}

export function buildCeoTurnEnvelope(input: {
  instruction: { text: string; extractionMethod: InstructionWindowExtractionMethod }
  sourceMaterialPresent: boolean
  sourceLength: number
  intentHint: SemanticIntentHint
}): CeoTurnEnvelope {
  return {
    schemaVersion: 1,
    instruction: {
      text: input.instruction.text,
      extractionMethod: input.instruction.extractionMethod,
    },
    sourceMaterial: {
      // Phase 1 deliberately preserves the existing sourceMaterialPresent/total
      // message-length semantics. Exact source spans and provenance remain a later
      // Source Authority concern; this field does not pretend that the mixed
      // head/tail window is a precise source segmentation.
      present: input.sourceMaterialPresent,
      length: input.sourceLength,
    },
    selfAssessmentRequested: input.intentHint === 'self_assessment',
    // Phase 1 is additive and intentionally does not infer document_comprehension
    // yet. That richer operation signal is the explicit scope of Phase 3.
    requestedOperation: requestedOperationFromIntent(input.intentHint),
  }
}
export function buildCanonicalConversationContext(input: { currentMessage: string; rows: readonly PersistedConversationRow[]; state: CeoConversationState; references: readonly ConversationReference[]; memories?: readonly PersistedMemoryRow[]; semanticInterpretation?: Partial<SemanticInterpretation> }): CanonicalConversationContext {
  const currentMessage = normalize(input.currentMessage)
  const instructionExtraction = extractInstructionWindowDetails(currentMessage)
  const instructionWindow = instructionExtraction.text
  const deterministic = deterministicMeaning(currentMessage, input.state, input.references)
  const deterministicSpeechAct = speechAct(currentMessage)
  const sourceMaterialPresent = currentMessage.length > instructionWindow.length
  const deterministicIntent = deterministicSpeechAct === 'correction' ? 'conversation' : userIntentHint(instructionWindow, sourceMaterialPresent)
  const suppliedConfidence = Number(input.semanticInterpretation?.confidence)
  const effectiveConfidence = Number.isFinite(suppliedConfidence) ? Math.max(0, Math.min(1, suppliedConfidence)) : 0
  const trustedModelSuggestions = input.semanticInterpretation?.source !== 'deterministic' && effectiveConfidence >= 0.72
  const suggestedIntent = trustedModelSuggestions ? sanitizeSuggestedIntent(input.semanticInterpretation?.suggestedIntent) : undefined
  const suggestedSpeechAct = trustedModelSuggestions ? sanitizeSuggestedSpeechAct(input.semanticInterpretation?.suggestedSpeechAct) : undefined
  const suggestedDepth = trustedModelSuggestions ? sanitizeSuggestedDepth(input.semanticInterpretation?.suggestedCognitiveDepth) : undefined
  const resolvedSpeechAct = deterministicSpeechAct === 'correction' ? 'correction' : (suggestedSpeechAct ?? deterministicSpeechAct)
  const deterministicIntentIsAuthoritative = deterministicIntent === 'self_assessment'
  const resolvedIntentHint = deterministicSpeechAct === 'correction' ? 'conversation' : deterministicIntentIsAuthoritative ? 'self_assessment' : (suggestedIntent ?? deterministicIntent)
  const trustedMeaning = trustedModelSuggestions ? normalize(input.semanticInterpretation?.meaning || '') : ''
  const meaning = trustedMeaning || deterministic
  const fallbackUncertainty: SemanticUncertainty[] = input.references.some((reference) => reference.ambiguous) ? [{ code: 'uncertain_reference', description: 'one or more conversational references remain uncertain', severity: 'medium' }] : []
  const semanticInterpretation: SemanticInterpretation = { schemaVersion: 1, meaning, confidence: Number.isFinite(suppliedConfidence) ? effectiveConfidence : (input.references.some((reference) => reference.ambiguous) ? 0.52 : 0.78), uncertainty: input.semanticInterpretation?.uncertainty ?? fallbackUncertainty, source: input.semanticInterpretation?.source ?? 'deterministic', suggestedIntent, suggestedSpeechAct, suggestedCognitiveDepth: suggestedDepth }
  const fallbackDepth = classifyCognitiveDepth(currentMessage, input.state, input.references.length)
  const turnEnvelope = buildCeoTurnEnvelope({
    instruction: instructionExtraction,
    sourceMaterialPresent,
    sourceLength: currentMessage.length,
    intentHint: resolvedIntentHint,
  })
  return { schemaVersion: 1, currentMessage, instruction: instructionWindow, sourceLength: currentMessage.length, turnEnvelope, meaning, semanticInterpretation, intentHint: resolvedIntentHint, speechAct: resolvedSpeechAct, cognitiveDepth: suggestedDepth ?? fallbackDepth, referenceScope: referenceScope(input.references, currentMessage), references: input.references, worldModel: buildWorldModel(input.state, input.memories ?? [], input.rows), state: input.state }
}
// Stage 2 of the CEO Conversation Kernel migration (2026-09-18): buildConversationDecisionContract
// used to be rebuilt from scratch here on every call, even though composeCeoContext's own call site
// (its only real production caller) has ALREADY built the authoritative one for this exact context a
// moment earlier -- pure waste of the same deterministic computation, and the literal "overlapping
// decide-stage" the migration plan's Stage 2 exists to remove. `contract` lets a caller that already
// has one pass it straight through instead of paying for a second, byte-identical build; omitting it
// preserves the original self-contained behavior for every other caller (tests, offline tooling).
export function renderCanonicalConversationContext(context: CanonicalConversationContext, contract?: ConversationDecisionContract): string { const refs = context.references.length ? context.references.map((reference) => `- ${reference.phrase} → ${reference.resolvedText ?? 'unresolved'} (${Math.round(reference.confidence * 100)}%, ${reference.ambiguous ? 'ambiguous' : 'resolved'})`).join('\n') : '- none'; const world = context.worldModel; const decisionContract = contract ?? buildConversationDecisionContract(context); return ['CANONICAL CEO COGNITIVE CONTEXT (authoritative semantic interpretation; context only, not external evidence):', `Current message: ${context.currentMessage}`, `Meaning: ${context.meaning}`, `Semantic confidence: ${Math.round(context.semanticInterpretation.confidence * 100)}%`, `Semantic uncertainty: ${context.semanticInterpretation.uncertainty.map((item) => `${item.code}=${item.severity}`).join('; ') || 'none'}`, `Intent hint: ${context.intentHint}`, `Speech act: ${context.speechAct}`, `Cognitive depth: ${context.cognitiveDepth}`, `Reference scope: ${context.referenceScope}`, 'Resolved references:', refs, `Working topic: ${world.workingTopic || 'unknown'}`, `Subtopics: ${world.subtopics.join(', ') || 'none'}`, `User goals: ${world.userGoals.join(' | ') || 'none'}`, `Prior decisions: ${world.decisions.join(' | ') || 'none'}`, `Commitments: ${world.commitments.join(' | ') || 'none'}`, `Open loops: ${world.openLoops.join(' | ') || 'none'}`, `Active threads: ${world.activeThreads.join(' | ') || 'none'}`, `Important entities: ${world.importantEntities.join(', ') || 'none'}`, `Recent corrections: ${world.recentCorrections.join(' | ') || 'none'}`, `Durable memory keys: ${world.durableMemoryKeys.join(', ') || 'none'}`, renderConversationDecisionContract(decisionContract), 'Authority rule: downstream CEO reasoning, response quality, and routing should consume this semantic interpretation rather than independently reinterpreting the current user message.'].join('\n') }
