import type { CeoIntent, RequestedOperation } from './ceo-cognitive-contract'
import type { SelfReflectionClassification } from './ceo-self-reflection'

/**
 * Source Authority Phase 4: reusable contract-consistency rules for intent
 * decisions that become unsafe when source material can masquerade as user instruction.
 *
 * The gate is intentionally small and declarative:
 *   condition -> requirement -> fallback
 *
 * It owns consistency, not classification. Callers still decide the candidate
 * intent; this module only verifies that the candidate is permitted by the
 * authoritative turn envelope.
 */

export type ContractConsistencyRuleId =
  | 'self_assessment_requires_authoritative_request'
  | 'production_action_requires_authoritative_command'
  | 'mission_action_requires_authoritative_command'
  | 'tool_action_requires_authoritative_command'
  | 'research_requires_authoritative_request'

export interface ContractConsistencyContext {
  candidateIntent: CeoIntent
  candidateSelfReflection: SelfReflectionClassification
  sourceMaterialPresent: boolean
  authoritativeInstruction: string
  selfAssessmentRequested: boolean
  requestedOperation: RequestedOperation
}

export interface ContractConsistencyResult {
  effectiveIntent: CeoIntent
  effectiveSelfReflection: SelfReflectionClassification
  violations: readonly ContractConsistencyRuleId[]
  appliedRules: readonly ContractConsistencyRuleId[]
}

interface ConsistencyRule {
  id: ContractConsistencyRuleId
  applies: (context: ContractConsistencyContext) => boolean
  requirement: (context: ContractConsistencyContext) => boolean
  fallback: (context: ContractConsistencyContext) => {
    intent: CeoIntent
    selfReflection: SelfReflectionClassification
  }
}

const SELF_ASSESSMENT_RULE: ConsistencyRule = {
  id: 'self_assessment_requires_authoritative_request',
  applies: (context) => context.sourceMaterialPresent && (
    context.candidateIntent === 'self_assessment'
    || context.candidateSelfReflection.isSelfReflective
    || context.selfAssessmentRequested
  ),
  requirement: (context) => {
    if (!context.selfAssessmentRequested) return context.candidateIntent === 'conversation'
    if (context.candidateIntent === 'self_assessment') return true
    if (context.candidateIntent === 'production_action') return hasExplicitAuthoritativeCommand(context.authoritativeInstruction, 'production') || context.requestedOperation === 'action'
    if (context.candidateIntent === 'mission_action') return hasExplicitAuthoritativeCommand(context.authoritativeInstruction, 'mission') || context.requestedOperation === 'action'
    if (context.candidateIntent === 'tool_action') return hasExplicitAuthoritativeCommand(context.authoritativeInstruction, 'tool') || context.requestedOperation === 'action'
    return context.candidateIntent === 'conversation' && !context.candidateSelfReflection.isSelfReflective
  },
  fallback: (context) => {
    if (context.selfAssessmentRequested) {
      return {
        intent: 'self_assessment',
        selfReflection: {
          kind: 'capability_assessment',
          isSelfReflective: true,
          reason: 'Canonical CeoTurnEnvelope explicitly requested self-assessment.',
        },
      }
    }
    return {
      intent: documentFallbackIntent(context.requestedOperation),
      selfReflection: {
        kind: 'none',
        isSelfReflective: false,
        reason: 'Canonical CeoTurnEnvelope does not authorize self-assessment for this source-bearing turn.',
      },
    }
  },
}

const PRODUCTION_ACTION_RULE: ConsistencyRule = {
  id: 'production_action_requires_authoritative_command',
  applies: (context) => context.sourceMaterialPresent && context.candidateIntent === 'production_action',
  requirement: (context) => context.requestedOperation === 'action' || hasExplicitAuthoritativeCommand(context.authoritativeInstruction, 'production'),
  fallback: (context) => ({
    intent: documentFallbackIntent(context.requestedOperation),
    selfReflection: context.candidateSelfReflection,
  }),
}

const MISSION_ACTION_RULE: ConsistencyRule = {
  id: 'mission_action_requires_authoritative_command',
  applies: (context) => context.sourceMaterialPresent && context.candidateIntent === 'mission_action',
  requirement: (context) => context.requestedOperation === 'action' || hasExplicitAuthoritativeCommand(context.authoritativeInstruction, 'mission'),
  fallback: (context) => ({
    intent: documentFallbackIntent(context.requestedOperation),
    selfReflection: context.candidateSelfReflection,
  }),
}

const RESEARCH_RULE: ConsistencyRule = {
  id: 'research_requires_authoritative_request',
  applies: (context) => context.sourceMaterialPresent && context.candidateIntent === 'research',
  requirement: (context) => context.requestedOperation === 'research' || hasExplicitAuthoritativeResearch(context.authoritativeInstruction),
  fallback: (context) => ({
    intent: documentFallbackIntent(context.requestedOperation),
    selfReflection: context.candidateSelfReflection,
  }),
}

const TOOL_ACTION_RULE: ConsistencyRule = {
  id: 'tool_action_requires_authoritative_command',
  applies: (context) => context.sourceMaterialPresent && context.candidateIntent === 'tool_action',
  requirement: (context) => context.requestedOperation === 'action' || hasExplicitAuthoritativeCommand(context.authoritativeInstruction, 'tool'),
  fallback: (context) => ({
    intent: documentFallbackIntent(context.requestedOperation),
    selfReflection: context.candidateSelfReflection,
  }),
}

// Deep-audit fix (2026-09-20): the other rules above only ever DOWNGRADE a risky candidateIntent
// (self_assessment/production_action/mission_action/tool_action/research) that lacks authoritative
// support. None of them covered the opposite gap: inferSemanticIntent's own deterministic keyword
// list has no "comprehension"/"comprehend" alternative at all, so a source-bearing turn whose only
// real signal is a document operation (e.g. "Please make a deep comprehension of this report.", with
// no other analyze/research/deploy/decision keyword anywhere in the windowed text) fell all the way
// through to the bare 'conversation' default -- with requestedOperation correctly recognizing it as
// document_comprehension, but nothing ever consulting that signal to strengthen the classification.
// This rule closes that gap the same way Phase 3's own design intended requestedOperation to be used:
// as a strengthening signal, not a replacement for CeoIntent.
const DOCUMENT_OPERATION_MINIMUM_RULE: ConsistencyRule = {
  id: 'document_operation_requires_analysis_minimum',
  applies: (context) => context.sourceMaterialPresent && context.candidateIntent === 'conversation' && isDocumentOperation(context.requestedOperation),
  requirement: () => false,
  fallback: (context) => ({
    intent: 'analysis',
    selfReflection: context.candidateSelfReflection,
  }),
}

const CONSISTENCY_RULES: readonly ConsistencyRule[] = [
  SELF_ASSESSMENT_RULE,
  PRODUCTION_ACTION_RULE,
  MISSION_ACTION_RULE,
  TOOL_ACTION_RULE,
  RESEARCH_RULE,
  DOCUMENT_OPERATION_MINIMUM_RULE,
]

function isDocumentOperation(operation: RequestedOperation): boolean {
  return operation === 'document_comprehension'
    || operation === 'document_summary'
    || operation === 'document_critique'
    || operation === 'document_compare'
    || operation === 'document_extract'
}

// Deep-audit fix (2026-09-20): this only ever mapped the five document_* operations to 'analysis',
// treating every other requestedOperation -- including 'analysis'/'decision' themselves, which
// inferRequestedOperation (ceo-cognitive-conversation.ts) can independently assign directly from the
// authoritative instruction -- as if requestedOperation carried no information at all, falling all
// the way to the generic 'conversation' default. A source-tail "production"/"deploy" mention (e.g.
// inside "update the production configuration") could still flip inferSemanticIntent's OWN separate
// keyword scan to 'production_action', get correctly rejected by PRODUCTION_ACTION_RULE for lacking
// an authoritative command, and then land on 'conversation' instead of the 'analysis' the
// authoritative instruction ("Please analyze this report.") actually asked for. 'analysis' and
// 'decision' are both non-mission, tool-free, LLM-only intents (see deterministicIntentIsNonMission
// in ceo-pre-router.ts) -- safe to use directly as a fallback destination, unlike 'research' (real
// external evidence acquisition) or 'action'/'self_assessment' (elevated authority), which stay
// mapped to 'conversation' here precisely because a rejected rule's fallback must never grant the
// same class of authority the rule just declined to authorize.
function documentFallbackIntent(operation: RequestedOperation): CeoIntent {
  if (isDocumentOperation(operation)) return 'analysis'
  if (operation === 'analysis' || operation === 'decision') return operation
  return 'conversation'
}

function hasExplicitAuthoritativeResearch(instruction: string): boolean {
  const text = instruction.trim()
  if (!text) return false
  const direct = /\b(?:research|search|look\s+(?:this|that|it)\s+up|find\s+(?:out|information)|verify|validate|fact[- ]check)\b/i
  const question = /^(?:what(?:'s|\s+is)\s+the\s+(?:latest|current)\s+(?:on|about)\b|what(?:'s|\s+is)\s+(?:the\s+)?(?:latest|current)\s+(?:news|information|updates?)\b|what\s+(?:is|are)\s+the\s+(?:latest|current)\s+(?:news|information|updates?)\s+(?:on|about)\b)/i
  const directive = /(?:^|[.!?]\s*|,\s*(?:then|and|also)\s+|\b(?:then|and)\s+)(?:please\s+|can\s+you\s+|could\s+you\s+|would\s+you\s+|i\s+(?:want|need)(?:\s+you)?\s+to\s+|let\x27s\s+)?(?:research|search|look\s+(?:this|that|it)\s+up|find\s+(?:out|information)|verify|validate|fact[- ]check)\b/i
  return question.test(text) || directive.test(text)
}

function hasExplicitAuthoritativeCommand(instruction: string, kind: 'production' | 'mission' | 'tool'): boolean {
  const text = instruction.trim()
  if (!text) return false

  const verbs = kind === 'production'
    ? '(?:deploy|publish|ship|launch|release|promote|put\\s+(?:this\\s+)?(?:into|in)\\s+production)'
    : kind === 'mission'
      ? '(?:run|start|execute|manage|launch|create|fix|implement)'
      : '(?:create|delete|edit|update|change|schedule|send|run|execute|fix|hold\\s+(?:a|the)?\\s*(?:review\\s+)?meeting|buy|purchase|acquire|order)'

  // Explicit agent-directed forms only. Merely discussing an action ("the report says deploy")
  // does not satisfy the rule; this intentionally requires a directive frame in the authoritative
  // instruction itself. The canonical `requestedOperation === 'action'` signal is also accepted by
  // action rules because it is already derived from the authoritative instruction, which preserves
  // legitimate passive/first-person commands such as "I need the approved release deployed.".
  // Deep-audit fix (2026-09-20): the prefix-phrase group below used to be mandatory -- unlike the
  // parallel hasExplicitAuthoritativeResearch's own directive regex, which already makes it optional
  // -- so a second clause joined by a bare comma-conjunction ("Please do X, and deploy Y.") never
  // matched unless "deploy" was itself immediately preceded by "please"/"can you"/etc. a second time.
  // That silently defeated the "explicit self-assessment plus authoritative production command
  // preserves production authority" case this gate exists to protect. Making it optional (a trailing
  // `?`) mirrors the already-correct sibling function exactly.
  const directiveFrame = new RegExp(
    '(?:^|[.!?]\\s*|,\\s*(?:then|and|also)\\s+|\\b(?:then|and|also)\\s+)(?:please\\s+|can\\s+you\\s+|could\\s+you\\s+|would\\s+you\\s+|go\\s+ahead\\s+and\\s+|i\\s+(?:want|need)(?:\\s+you)?\\s+to\\s+|let\\x27s\\s+)?' +
    '(?:' + verbs + ')\\b',
    'i',
  )
  const bareImperative = new RegExp('^(?:' + verbs + ')\\b', 'i')
  return directiveFrame.test(text) || bareImperative.test(text)
}

/** Research is treated as a control-plane operation too: source text can otherwise contain words like "verify" or "research" that would silently authorize external evidence acquisition. */
export function enforceContractConsistency(context: ContractConsistencyContext): ContractConsistencyResult {
  let effectiveIntent = context.candidateIntent
  let effectiveSelfReflection = context.candidateSelfReflection
  const violations: ContractConsistencyRuleId[] = []
  const appliedRules: ContractConsistencyRuleId[] = []

  for (const rule of CONSISTENCY_RULES) {
    const current = { ...context, candidateIntent: effectiveIntent, candidateSelfReflection: effectiveSelfReflection }
    if (!rule.applies(current)) continue
    appliedRules.push(rule.id)
    if (rule.requirement(current)) continue
    violations.push(rule.id)
    const fallback = rule.fallback(current)
    effectiveIntent = fallback.intent
    effectiveSelfReflection = fallback.selfReflection
  }

  // The result is intentionally idempotent: re-applying the same rules to its own output
  // cannot introduce a new violation or mutate an already-compliant contract.
  return { effectiveIntent, effectiveSelfReflection, violations, appliedRules }
}