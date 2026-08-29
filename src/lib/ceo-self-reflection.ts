/** Canonical CEO self-reflection classification.
 *
 * This module is the single source of truth for requests whose subject is
 * Agent007/CEO itself. It is deterministic and intentionally free of LLM
 * calls so it cannot add latency or introduce a new provider dependency.
 *
 * The classifier identifies reflection only when the request is not an
 * explicit operational/research/mission action. Downstream layers consume
 * this decision instead of re-parsing the raw user text.
 */

export type SelfReflectionKind =
  | 'none'
  | 'casual_checkin'
  | 'performance_reflection'
  | 'capability_assessment'
  | 'readiness_assessment'

export interface SelfReflectionClassification {
  kind: SelfReflectionKind
  isSelfReflective: boolean
  reason: string
}

export type ExecutiveReadinessLevel = 'A' | 'B' | 'C' | 'D' | 'E'

export interface ExecutiveReadinessSynthesis {
  level: ExecutiveReadinessLevel
  label: string
  capability: string
  verified: string
  notProven: string
  nextEvidence: string
  observedAt?: number
}

const SELF_REFERENCE_RE = /\b(?:you|your|yourself|agent007|ceo|the\s+(?:agent|system|assistant))\b/i
const OPERATIONAL_COMMAND_RE = /^(?:please\s+)?(?:deploy|publish|send|buy|sell|invest|transfer|execute|implement|fix|create|delete|edit|update|change|launch|ship|start|stop|enable|disable|schedule|commit)\b/i
const TARGETED_OPERATION_RE = /\b(?:deploy|publish|send|buy|sell|invest|transfer|execute|implement|fix|create|delete|edit|update|change|launch|ship|start|stop|enable|disable|schedule|commit)\s+(?:this|the|my|our|approved|production|release|build|customer|invoice|mission|venture|business|company|campaign)\b/i
const RESEARCH_RE = /\b(?:research|search|look\s+up|find\s+(?:out|information)|verify|validate)\b/i
const MISSION_ACTION_RE = /\b(?:start|run|manage|execute|launch)\s+(?:this|the|my|our)\s+(?:mission|venture|business|company)\b|\b(?:start|execute|launch)\s+(?:a|an)\s+(?:mission|venture)\b/i
const ANALYSIS_TARGET_RE = /\b(?:analy[sz]e|assess|evaluate|review|diagnose|compare|design|plan)\b.*\b(?:this|that|these|those|the\s+(?:architecture|system|data|market|report|document|problem|request)|customer|churn|competitor|financial|legal)\b/i
const CASUAL_CHECKIN_RE = /^(?:how(?:'s|\s+is)\s+(?:it|everything|things?)\s+going|how\s+are\s+(?:you|things?)(?:\s+doing)?|how\s+do\s+you\s+do|how\s+is\s+(?:agent007|the\s+(?:system|ceo|agent))\s+doing|you\s+(?:good|okay|alright)|what(?:'s|\s+is)\s+new(?:\s+with\s+you)?)[!.?\s]*$/i
const PERFORMANCE_RE = /\b(?:improving|getting\s+better|performance|performing|progress|progressing|better|worse|declining|evolving|evolution|learning|developing|growth|how\s+have\s+you\s+been|how\s+are\s+you\s+performing)\b/i
const CAPABILITY_RE = /\b(?:strengths?|weakness(?:es)?|capabilit(?:y|ies)|capable|skills?|limitations?|what\s+can\s+you\s+do|what\s+are\s+you\s+good\s+at)\b/i
const READINESS_RE = /\b(?:ready|readiness|prepared|equipped|fit\s+to|able\s+to\s+manage|manage\s+(?:a\s+)?business(?:es)?|run\s+(?:a\s+)?business(?:es)?|run\s+(?:a\s+)?compan(?:y|ies)|business\s+management|autonom(?:y|ous))\b/i

export function classifyCeoSelfReflection(text: string): SelfReflectionClassification {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return { kind: 'none', isSelfReflective: false, reason: 'No substantive request.' }
  if (CASUAL_CHECKIN_RE.test(normalized)) return { kind: 'casual_checkin', isSelfReflective: false, reason: 'Short conversational check-in; keep it on the normal conversation path.' }
  if (!SELF_REFERENCE_RE.test(normalized)) return { kind: 'none', isSelfReflective: false, reason: 'No CEO self-reference detected.' }

  if (OPERATIONAL_COMMAND_RE.test(normalized) || TARGETED_OPERATION_RE.test(normalized) || RESEARCH_RE.test(normalized) || MISSION_ACTION_RE.test(normalized) || ANALYSIS_TARGET_RE.test(normalized)) {
    return { kind: 'none', isSelfReflective: false, reason: 'Explicit operational, research, mission, or external-analysis language takes precedence.' }
  }

  if (CASUAL_CHECKIN_RE.test(normalized)) return { kind: 'casual_checkin', isSelfReflective: false, reason: 'Short conversational check-in; keep it on the normal conversation path.' }
  if (READINESS_RE.test(normalized)) return { kind: 'readiness_assessment', isSelfReflective: true, reason: 'Self-readiness or business-management capability assessment.' }
  if (CAPABILITY_RE.test(normalized)) return { kind: 'capability_assessment', isSelfReflective: true, reason: 'Self-capability assessment.' }
  if (PERFORMANCE_RE.test(normalized) || /\b(?:how|where)\s+are\s+you\b/i.test(normalized)) return { kind: 'performance_reflection', isSelfReflective: true, reason: 'Self-performance or progress reflection.' }

  return { kind: 'none', isSelfReflective: false, reason: 'Self-reference detected but no safe reflective intent established.' }
}

/**
 * Deterministic executive-readiness synthesis over already-governed evidence.
 * Levels are cumulative and conservative: architecture supports A, explicit
 * governed operational capability supports B, current live execution plus
 * production-traffic proof supports C, repeatable outcomes supports D, and
 * sustained autonomy supports E. Stale evidence cannot advance readiness.
 */
export function synthesizeExecutiveReadiness(input: {
  operationalCapabilityVerified: boolean
  liveExecutionVerified: boolean
  productionTrafficVerified: boolean
  repeatableBusinessOutcomesVerified: boolean
  sustainedAutonomyVerified: boolean
  observedAt?: number
  maxEvidenceAgeMs?: number
  now?: number
}): ExecutiveReadinessSynthesis {
  const now = input.now ?? Date.now()
  const evidenceFresh = input.observedAt !== undefined && input.maxEvidenceAgeMs !== undefined
    ? now - input.observedAt >= 0 && now - input.observedAt <= input.maxEvidenceAgeMs
    : false
  const liveVerified = input.liveExecutionVerified && input.productionTrafficVerified && evidenceFresh

  if (liveVerified && input.sustainedAutonomyVerified && input.repeatableBusinessOutcomesVerified) {
    return {
      level: 'E',
      label: 'Sustained autonomy',
      capability: 'The system has evidence supporting autonomous business operation over a sustained period.',
      verified: 'Sustained autonomous operation is explicitly evidenced by governed outcome data.',
      notProven: 'No higher readiness category remains in this model.',
      nextEvidence: 'Continue monitoring sustained outcomes and governance exceptions.',
      observedAt: input.observedAt,
    }
  }

  if (liveVerified && input.repeatableBusinessOutcomesVerified) {
    return {
      level: 'D',
      label: 'Repeatable outcomes',
      capability: 'The system has evidence of repeatable business outcomes from live execution.',
      verified: 'Repeatable outcomes are explicitly evidenced by governed result data.',
      notProven: 'Sustained autonomous operation is not yet proven.',
      nextEvidence: 'Accumulate sustained autonomous-operation evidence.',
      observedAt: input.observedAt,
    }
  }

  if (liveVerified) {
    return {
      level: 'C',
      label: 'Live governed execution',
      capability: 'The system has evidence of successful governed execution in production.',
      verified: 'Live execution and production traffic are explicitly evidenced within the freshness window.',
      notProven: 'Repeatable business outcomes and sustained autonomy are not yet proven.',
      nextEvidence: 'Accumulate repeatable governed business outcomes.',
      observedAt: input.observedAt,
    }
  }

  if (input.operationalCapabilityVerified) {
    return {
      level: 'B',
      label: 'Governed operational capability',
      capability: 'The system has governed operational capabilities that are structurally verified.',
      verified: 'Operational capability is supported by repository and workflow verification.',
      notProven: 'Live production execution, repeatable outcomes, and sustained autonomy are not yet proven.',
      nextEvidence: 'Verify successful live execution against current production traffic.',
      observedAt: input.observedAt,
    }
  }

  return {
    level: 'A',
    label: 'Architectural foundation',
    capability: 'The system has an established executive architecture and governance foundation.',
    verified: 'Architectural capability is supported by code and CI contracts.',
    notProven: 'Operational capability, live execution, repeatable outcomes, and sustained autonomy are not yet proven.',
    nextEvidence: 'Establish explicit governed operational execution evidence.',
    observedAt: input.observedAt,
  }
}
