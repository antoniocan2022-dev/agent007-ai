import type { TaskType } from './subagent-governance'
import type { SelfReflectionKind } from './ceo-self-reflection'
import type { CeoFailure, CeoFailureReason } from './ceo-failure-reason'
import type { OperatorPlan } from './ceo-operator-intelligence'

// Long-document comprehension incident (2026-09-19), Phase 1: a pasted long document ("make a deep
// analysis of this text") was previously fragmented across three independent, hardcoded slice points
// that disagreed with each other -- ceo-context-composer.ts's MAX_MESSAGE_CHARS (12,000), the decision
// plan's objective (ceo-cognitive-kernel.ts, 4,000), and the semantic interpreter's CURRENT MESSAGE
// preview (ceo-semantic-interpreter.ts, 4,000) -- while the quality gate's own objective
// (objectiveFrom() in ceo-cognitive-lifecycle.ts) was completely unclamped. One canonical constant closes
// that fragmentation for any message under this size (the overwhelming majority of real long-text
// requests see byte-identical content at every layer). Sized against this codebase's real governed
// providers (Groq Llama 3.3 70B, Mistral Large, Cerebras gpt-oss-120b/Llama 3.3 -- documented ~128K-token
// context windows; see PROVIDER_RUNTIME_CONFIG in provider-control-plane.ts), not against Claude's 1M
// window, since only the lowest-priority OpenRouter->Claude path actually has that much room. Leaves
// headroom under the provider gateway's own preflight budget (DEFAULT_MAX_INPUT_TOKENS) for system
// prompt, conversation history, and reserved output tokens.
export const CEO_MESSAGE_CLAMP_CHARS = 200_000

// A message longer than this is treated as "may contain a pasted document," not "is definitely a short
// instruction" -- see extractInstructionWindow below.
const INSTRUCTION_WINDOW_THRESHOLD_CHARS = 2_000
// How much of the head and tail to keep when no explicit lead-in phrase is found. Real instructions
// overwhelmingly sit at the very start ("please analyze...") or very end ("...so what do you think?") of
// a long paste, with reference material dominating the middle -- unlike the challenge/verify/recommend
// keyword scan this replaces, which used to scan the ENTIRE message and could be tripped by that exact
// vocabulary appearing anywhere in the pasted source material itself.
const INSTRUCTION_WINDOW_EDGE_CHARS = 600
// Explicit lead-in phrases that mark everything after them as pasted/quoted source material rather than
// further instruction. Matched case-insensitively against the first occurrence only, so a document that
// happens to contain one of these phrases deep inside its own body can't retroactively redefine an
// earlier instruction. Requires the phrase to be immediately followed by a line break -- i.e. an actual
// paragraph boundary, not just more prose in the same sentence -- so "read this report and challenge its
// conclusion" (a complete instruction in its own right) doesn't get truncated at "read this" merely
// because the word "this" happens to appear early in the sentence.
const SOURCE_LEAD_IN_RE = /\b(?:(?:analyz|analys|review|read|comprehend|summariz|summaris)e?\s+(?:this|the following|these)\s*:?|(?:(?:give(?:\s+me)?|make(?:\s+(?:me|a))?)\s+(?:a\s+)?(?:deep|thorough|comprehensive)?\s*comprehension\s+of|(?:deeply\s+)?comprehend|understand|make\s+sense\s+of|walk(?:\s+me)?\s+through)\s+(?:this|the following|these)\s*:?|(?:here(?:'s| is)|the following is)\s+(?:the|a|an)?\s*(?:report|document|text|article|transcript|analysis)\s*:?)(?=\s*\n)/i

/**
 * Extracts the portion of a user turn that plausibly carries the user's own instruction, as opposed to
 * pasted/quoted source material the user wants analyzed. Short messages are returned unchanged -- they
 * ARE the instruction. Long messages either stop at the first explicit lead-in phrase ("analyze this:",
 * "here is the report:", ...) or, absent one, fall back to a bounded head+tail window. Callers that
 * classify intent/response-action/routing from keyword matches must scan this window, never the raw
 * message, so that vocabulary inside a pasted document (e.g. a business report that happens to use the
 * word "challenge") can never masquerade as a command to Agent007.
 */
export type InstructionWindowExtractionMethod = 'short_message' | 'lead_in' | 'head_tail_fallback'

export interface InstructionWindowResult {
  text: string
  // Primary instruction text used for authoritative intent decisions. For long
  // turns this is the leading user-framing segment; the retained tail remains
  // in `text` for backward-compatible context/clarification behavior but is
  // deliberately not treated as authoritative self-assessment instruction.
  authoritativeText: string
  extractionMethod: InstructionWindowExtractionMethod
}

/**
 * Returns both the bounded instruction text and how the boundary was established.
 *
 * The metadata is intentionally additive: the existing extractInstructionWindow()
 * API still returns only the text, so current callers keep identical behavior.
 */
export function extractInstructionWindowDetails(message: string): InstructionWindowResult {
  const trimmed = message.trim()
  if (trimmed.length <= INSTRUCTION_WINDOW_THRESHOLD_CHARS) {
    return { text: trimmed, authoritativeText: trimmed, extractionMethod: 'short_message' }
  }
  const tail = trimmed.slice(-INSTRUCTION_WINDOW_EDGE_CHARS)
  const leadIn = trimmed.match(SOURCE_LEAD_IN_RE)
  if (leadIn && typeof leadIn.index === 'number') {
    const head = trimmed.slice(0, leadIn.index + leadIn[0].length)
    // Audit fix (2026-09-19): always also keep the tail, even on a lead-in match. A lead-in phrase can
    // legitimately occur INSIDE ordinary pasted material rather than in the user's own framing. Keeping
    // the tail preserves the common paste-then-ask pattern without changing the existing window contents.
    const text = head === tail || head.endsWith(tail) ? head : `${head}\n${tail}`
    return { text, authoritativeText: head, extractionMethod: 'lead_in' }
  }
  const head = trimmed.slice(0, INSTRUCTION_WINDOW_EDGE_CHARS)
  return { text: `${head}\n${tail}`, authoritativeText: head, extractionMethod: 'head_tail_fallback' }
}

/** Backward-compatible text-only facade used by existing callers. */
export function extractInstructionWindow(message: string): string {
  return extractInstructionWindowDetails(message).text
}

export type PreRoute = 'fast' | 'full' | 'ambiguous'
export type CognitivePath = 'fast' | 'full' | 'critical'
export type ReasoningStrategy = 'direct' | 'multi_pass' | 'independent_review'
export type EvidenceState = 'NOT_APPLICABLE' | 'LIVE_EXECUTED' | 'LIVE_VERIFIED' | 'VERIFIED_CACHED' | 'MEMORY_ONLY' | 'PARTIAL_UNCONFIRMED' | 'UNAVAILABLE'
export type QualityDecision = 'PASS' | 'ESCALATE' | 'DEGRADED'
export type VerificationStatus = 'NOT_REQUIRED' | 'NOT_PERFORMED' | 'INDEPENDENT_PASS' | 'FAILED'
export type EvidenceScope = 'none' | 'internal_state' | 'live_system' | 'external_web' | 'mixed'
export type EvidenceClass = 'none' | 'internal_state' | 'external_web' | 'mixed'
export type EvidenceDomain = 'none' | 'public_equity' | 'general_web' | 'market' | 'news' | 'competitor' | 'regulatory' | 'business_due_diligence' | 'internal_finance' | 'internal_operations' | 'unknown'
export type EvidenceOperation = 'none' | 'explain' | 'research' | 'compare' | 'analyze' | 'forecast' | 'recommend' | 'decide' | 'verify'
export type TemporalScope = 'none' | 'historical' | 'recent' | 'current' | 'timeless'
export type EvidenceProfile = 'none' | 'general_research' | 'public_equity' | 'market_current' | 'news_recent' | 'competitor_research' | 'business_due_diligence'
export interface EvidenceFreshness { observedAt: number; maxAgeMs: number }
export type CeoIntent = 'conversation' | 'self_assessment' | 'analysis' | 'opinion' | 'decision' | 'research' | 'tool_action' | 'mission_action' | 'production_action'
export type RequestedOperation = 'conversation' | 'document_comprehension' | 'document_summary' | 'document_critique' | 'document_compare' | 'document_extract' | 'analysis' | 'decision' | 'research' | 'action' | 'self_assessment'
export type EvidenceRequirement = 'none' | 'internal_state' | 'memory' | 'live_system' | 'external_web' | 'database' | 'multi_source'
export type ExecutionRequirement = 'no_action' | 'llm_only' | 'one_tool' | 'multi_tool' | 'multi_source' | 'subagent' | 'mission' | 'production'
export type OrchestrationOwner = 'ceo_lifecycle' | 'operational_orchestrator'
export type ResponseAction = 'answer' | 'clarify' | 'explain' | 'challenge' | 'recommend' | 'decide' | 'execute' | 'verify'

// Long-document comprehension, Phase 2 (2026-09-20): a canonical classification of what kind of
// comprehension job this turn is, computed once per request instead of being independently re-derived
// (as a bare `objective.length >= threshold` check) inside the quality gate every time it runs. Kept
// deliberately honest about what the available signals (responseAction, source length) can actually
// tell apart today -- 'summarize'/'compare'/'extract' are reserved for a future, richer intent
// classifier that can genuinely distinguish them from plain analysis; nothing upstream produces that
// signal yet, so fabricating them here would just be guessing.
export type CeoComprehensionMode = 'conversation' | 'summarize' | 'explain' | 'deep_analysis' | 'critique' | 'compare' | 'extract'
// A message longer than this is treated as carrying a document to comprehend, not just a short
// instruction/question -- mirrors ceo-response-quality-gate.ts's own LONG_OBJECTIVE_CHARS threshold
// (kept as a separate constant rather than imported, since that file's constant governs a narrower,
// gate-specific lexical-coverage decision and the two are free to diverge if either is retuned later).
const LONG_SOURCE_CHARS = 4_000
/**
 * Infers the comprehension mode for a turn from signals already computed upstream
 * (ceo-conversation-decision-contract.ts's responseAction, the canonical objective's length) rather than
 * requiring every caller to independently guess. Callers that don't yet have a responseAction (e.g.
 * direct/offline callers) still get a sound default from source length alone.
 *
 * Deep-audit fix (2026-09-20): source length is checked for EVERY branch, not just the fallback --
 * the only real consumer of this today (ceo-response-quality-gate.ts's objectiveCoverage relaxation)
 * treats 'critique'/'deep_analysis' as "long document, relax lexical coverage." Returning 'critique' for
 * *any* challenge responseAction regardless of length (the original version of this function) meant a
 * short "please challenge my assumption" turn with no document attached at all got the same relaxed
 * coverage requirement as a genuine long-document critique -- silently weakening quality enforcement for
 * ordinary short adversarial replies. Symmetrically, a long "explain this report" turn mapped to
 * 'explain' (not in the long-document set) and LOST the relaxation Phase 1 introduced specifically for
 * this incident. Gating both branches on sourceLength fixes both directions at once.
 */
export function inferComprehensionMode(input: { responseAction?: ResponseAction; sourceLength: number }): CeoComprehensionMode {
  const longSource = input.sourceLength >= LONG_SOURCE_CHARS
  if (input.responseAction === 'challenge') return longSource ? 'critique' : 'conversation'
  if (input.responseAction === 'explain') return longSource ? 'deep_analysis' : 'explain'
  if (longSource) return 'deep_analysis'
  return 'conversation'
}
export interface SemanticUncertainty { code: string; description: string; severity: 'low' | 'medium' | 'high' }
export interface CeoExecutionContract { intent: CeoIntent; selfReflectionKind?: SelfReflectionKind; evidenceClass: EvidenceClass; domain: EvidenceDomain; operation: EvidenceOperation; temporalScope: TemporalScope; evidenceProfile: EvidenceProfile; evidenceRequirement: EvidenceRequirement; executionRequirement: ExecutionRequirement; orchestrationOwner: OrchestrationOwner; maxTurns: number; maxRecoveries: number; latencyBudgetMs: number; toolRequired: boolean; subagentsRequired: boolean; reason: string }

/** Canonical evidence profile derived from the governed evidence domain. */
export function deriveEvidenceProfile(domain: EvidenceDomain): EvidenceProfile {
  if (domain === 'public_equity') return 'public_equity'
  if (domain === 'market') return 'market_current'
  if (domain === 'news') return 'news_recent'
  if (domain === 'competitor') return 'competitor_research'
  if (domain === 'business_due_diligence') return 'business_due_diligence'
  if (domain === 'general_web' || domain === 'regulatory') return 'general_research'
  return 'none'
}

/** Normalizes the evidence fields so domain and profile cannot silently disagree. */
export function normalizeCeoEvidenceContract(contract: CeoExecutionContract): CeoExecutionContract {
  const derivedProfile = deriveEvidenceProfile(contract.domain)
  const isExternalEvidenceDomain = contract.domain !== 'none' && !contract.domain.startsWith('internal_') && contract.domain !== 'unknown'
  if (!isExternalEvidenceDomain) return contract
  if (contract.domain === 'public_equity') {
    return {
      ...contract,
      evidenceClass: 'external_web',
      evidenceProfile: 'public_equity',
      evidenceRequirement: 'multi_source',
      executionRequirement: 'multi_source',
      toolRequired: true,
      orchestrationOwner: 'ceo_lifecycle',
    }
  }
  return { ...contract, evidenceProfile: derivedProfile }
}

/** Fail closed if an impossible external/public-equity evidence contract crosses a trust boundary. */
export function assertCeoEvidenceContractInvariant(contract: CeoExecutionContract): void {
  if (contract.domain === 'public_equity') {
    if (
      contract.evidenceClass !== 'external_web' ||
      contract.evidenceProfile !== 'public_equity' ||
      contract.evidenceRequirement !== 'multi_source' ||
      contract.executionRequirement !== 'multi_source' ||
      contract.toolRequired !== true ||
      contract.orchestrationOwner !== 'ceo_lifecycle'
    ) {
      throw new Error('CEO_EVIDENCE_CONTRACT_INVARIANT_VIOLATION: public_equity requires external_web + public_equity profile + multi_source/tool-required CEO research')
    }
  }
}
export interface PreRouteDecision { route: PreRoute; reason: string; missionRelevant: boolean; complexitySignals: number; taskClass?: TaskType; adaptiveExecutionClass?: 'fast' | 'standard' | 'deep' | 'mission'; executionContract: CeoExecutionContract }
export interface DecisionPlan { requestId: string; preRoute: PreRoute; path: CognitivePath; objective: string; taskClass: TaskType; missionRelevant: boolean; requiredCapabilities: string[]; qualityTier: 'standard' | 'high' | 'critical'; reasoningStrategy: ReasoningStrategy; cognitiveDepth: 0 | 1 | 2 | 3 | 4; verificationRequired: boolean; maxEscalations: number; maxProviderAttempts: number; latencyBudgetMs: number; executionContract: CeoExecutionContract }
export interface ExecutionStage { name: 'primary' | 'refinement' | 'independent_review' | 'synthesis'; purpose: string }
export type CeoGenerationStage = 'none' | 'primary' | 'refinement' | 'semantic_repair' | 'independent_review' | 'synthesis' | 'escalation'
export interface CeoGenerationDiagnostics { primaryOutputProduced: boolean; primaryQualityDecision: QualityDecision | 'NOT_RUN'; finalOutputProduced: boolean; finalStage: CeoGenerationStage; escalationCount: number }
export interface ExecutionPlan { requestId: string; path: CognitivePath; reasoningStrategy: ReasoningStrategy; stages: ExecutionStage[]; maxEscalations: number; maxProviderAttempts: number; operatorPlan?: OperatorPlan }
export interface ContextContinuitySummary { score: number; relevantTurnCount: number; matchedTurnCount: number; understood: boolean }
export interface ConversationQualitySummary { score: number; continuity: number; relevance: number; naturalness: number; toneAlignment: number; coherence: number; nonRepetition: number; initiative: number; referenceResolution: number; personalityConsistency: number; progression: number; issues: string[] }
export interface CeoResponseIntegritySummary { currentObjectiveMatch: boolean; requestedActionSatisfied: boolean; crossObjectiveSubstitution: boolean; staleResponseLikelihood: number; internalArtifactLeakage: boolean }
// Recommendation 3 (2026-09-20): a mirror of ceo-structural-quality-gate.ts's StructuralQualityAssessment,
// defined here (rather than importing that module's own type) so this shared contract file doesn't take
// a dependency on a specific feature module -- the same reasoning as every other *Summary type in this
// file. `applicable: false` (the default for any turn that never produced Phase 3's structured source
// model) means every other field is a fixed, meaningless default; callers should check `applicable`
// before reading the rest.
export interface StructuralQualitySummary { applicable: boolean; claimCoverage: number; claimCoverageOk: boolean; representedSectionCount: number; contradictionFlaggedUpstream: boolean; contradictionPreserved: boolean; sourceAttributionPresent: boolean }
export interface CeoControlPlaneSummary { schemaVersion: 1; requestId?: string; responseAction?: ResponseAction; evidenceState: EvidenceState; qualityDecision: QualityDecision; executionCompleted: boolean; verified: boolean; degraded: boolean }
export interface CeoResponseCandidate { candidateId: string; requestId?: string; content: string; contentHash: string; createdAt: number }
export interface CeoQualityDecision { decisionId: string; candidateId: string; candidateHash: string; decision: QualityDecision; reasons: readonly string[]; decidedAt: number }
export interface CeoResponseDecisionEnvelope { candidate: CeoResponseCandidate; quality: CeoQualityDecision; controlPlaneSummary: CeoControlPlaneSummary }
export interface FinalResponseProvenance { finalizationId: string; finalResponseHash: string; finalContentLength: number; candidateId?: string; candidateHash?: string; qualityDecisionId?: string; responseAction?: ResponseAction; sanitized: boolean; rejected: boolean }
export interface QualityResult { decision: QualityDecision; evidenceState: EvidenceState; verificationStatus: VerificationStatus; checks: { nonEmpty: boolean; contractValid: boolean; objectiveCoverage: boolean; internalConsistency: boolean; evidenceDiscipline: boolean; actionableStructure: boolean }; evidenceScope?: EvidenceScope; evidenceFreshness?: EvidenceFreshness; claimScopes?: EvidenceScope[]; contextContinuity?: ContextContinuitySummary; conversationQuality?: ConversationQualitySummary; responseIntegrity?: CeoResponseIntegritySummary; structuralQuality?: StructuralQualitySummary; finalResponseProvenance?: FinalResponseProvenance; failureReason?: CeoFailureReason; failure?: CeoFailure; reasons: string[] }
export interface CognitiveLifecycleResult { content: string; provider?: string; model?: string; responseMs: number; attempts: string[]; executionPlan: ExecutionPlan; decisionPlan: DecisionPlan; quality: QualityResult; evidenceState: EvidenceState; degraded: boolean; failureReason?: CeoFailureReason; generation: CeoGenerationDiagnostics }
