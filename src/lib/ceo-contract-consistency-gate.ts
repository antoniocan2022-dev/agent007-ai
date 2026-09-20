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
  requirement: (context) => context.candidateIntent === (context.selfAssessmentRequested ? 'self_assessment' : 'conversation'),
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
  requirement: (context) => hasExplicitAuthoritativeCommand(context.authoritativeInstruction, 'production'),
  fallback: (context) => ({
    intent: documentFallbackIntent(context.requestedOperation),
    selfReflection: context.candidateSelfReflection,
  }),
}

const MISSION_ACTION_RULE: ConsistencyRule = {
  id: 'mission_action_requires_authoritative_command',
  applies: (context) => context.sourceMaterialPresent && context.candidateIntent === 'mission_action',
  requirement: (context) => hasExplicitAuthoritativeCommand(context.authoritativeInstruction, 'mission'),
  fallback: (context) => ({
    intent: documentFallbackIntent(context.requestedOperation),
    selfReflection: context.candidateSelfReflection,
  }),
}

const TOOL_ACTION_RULE: ConsistencyRule = {
  id: 'tool_action_requires_authoritative_command',
  applies: (context) => context.sourceMaterialPresent && context.candidateIntent === 'tool_action',
  requirement: (context) => hasExplicitAuthoritativeCommand(context.authoritativeInstruction, 'tool'),
  fallback: (context) => ({
    intent: documentFallbackIntent(context.requestedOperation),
    selfReflection: context.candidateSelfReflection,
  }),
}

const CONSISTENCY_RULES: readonly ConsistencyRule[] = [
  SELF_ASSESSMENT_RULE,
  PRODUCTION_ACTION_RULE,
  MISSION_ACTION_RULE,
  TOOL_ACTION_RULE,
]

function documentFallbackIntent(operation: RequestedOperation): CeoIntent {
  return operation === 'document_comprehension'
    || operation === 'document_summary'
    || operation === 'document_critique'
    || operation === 'document_compare'
    || operation === 'document_extract'
    ? 'analysis'
    : 'conversation'
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
  // instruction itself.
  const directiveFrame = new RegExp(
    '(?:^|[.!?]\\s*|,\\s*)(?:please\\s+|can\\s+you\\s+|could\\s+you\\s+|would\\s+you\\s+|go\\s+ahead\\s+and\\s+|i\\s+(?:want|need)\\s+you\\s+to\\s+|let\\x27s\\s+)' +
    '(?:' + verbs + ')\\b',
    'i',
  )
  const bareImperative = new RegExp('^(?:' + verbs + ')\\b', 'i')
  return directiveFrame.test(text) || bareImperative.test(text)
}

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