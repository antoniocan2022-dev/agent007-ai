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

const SELF_REFERENCE_RE = /\b(?:you|your|yourself|agent007|ceo|the\s+(?:agent|system|assistant))\b/i
const EXPLICIT_OPERATION_RE = /\b(?:deploy|publish|send|buy|sell|invest|transfer|execute|implement|fix|create|delete|edit|update|change|launch|ship|start|stop|run|enable|disable|schedule|commit)\b/i
const RESEARCH_RE = /\b(?:research|search|look\s+up|find\s+(?:out|information)|verify|validate)\b/i
const MISSION_RE = /\b(?:mission|venture|revenue|transaction|production)\b/i
const MISSION_TARGET_RE = /\b(?:manage|run)\s+(?:this|the|my|our)\s+(?:business|company|venture)\b/i
const CASUAL_CHECKIN_RE = /^(?:how(?:'s|\s+is)\s+(?:it|everything|things?)\s+going|how\s+are\s+(?:you|things?)(?:\s+doing)?|how\s+is\s+(?:agent007|the\s+(?:system|ceo|agent))\s+doing|you\s+(?:good|okay|alright)|what(?:'s|\s+is)\s+new(?:\s+with\s+you)?)[!.?\s]*$/i
const PERFORMANCE_RE = /\b(?:improving|getting\s+better|performance|performing|progress|progressing|better|worse|declining|evolving|evolution|learning|developing|growth|how\s+have\s+you\s+been|how\s+are\s+you\s+performing)\b/i
const CAPABILITY_RE = /\b(?:strengths?|weakness(?:es)?|capabilit(?:y|ies)|capable|skills?|limitations?|what\s+can\s+you\s+do|what\s+are\s+you\s+good\s+at)\b/i
const READINESS_RE = /\b(?:ready|readiness|prepared|equipped|fit\s+to|able\s+to\s+manage|manage\s+(?:a\s+)?business(?:es)?|run\s+(?:a\s+)?business(?:es)?|run\s+(?:a\s+)?compan(?:y|ies)|business\s+management|autonom(?:y|ous))\b/i

export function classifyCeoSelfReflection(text: string): SelfReflectionClassification {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return { kind: 'none', isSelfReflective: false, reason: 'No substantive request.' }
  if (!SELF_REFERENCE_RE.test(normalized)) return { kind: 'none', isSelfReflective: false, reason: 'No CEO self-reference detected.' }

  // Explicit work always outranks self-reflection. This prevents phrases such
  // as "can you deploy" or "run the business" from stealing an operational lane.
  if (EXPLICIT_OPERATION_RE.test(normalized) || RESEARCH_RE.test(normalized) || MISSION_RE.test(normalized) || MISSION_TARGET_RE.test(normalized)) {
    return { kind: 'none', isSelfReflective: false, reason: 'Explicit operational, research, or mission language takes precedence.' }
  }

  if (CASUAL_CHECKIN_RE.test(normalized)) {
    return { kind: 'casual_checkin', isSelfReflective: true, reason: 'Short self-referential check-in.' }
  }
  if (READINESS_RE.test(normalized)) {
    return { kind: 'readiness_assessment', isSelfReflective: true, reason: 'Self-readiness or business-management capability assessment.' }
  }
  if (CAPABILITY_RE.test(normalized)) {
    return { kind: 'capability_assessment', isSelfReflective: true, reason: 'Self-capability assessment.' }
  }
  if (PERFORMANCE_RE.test(normalized) || /\b(?:how|where)\s+are\s+you\b/i.test(normalized)) {
    return { kind: 'performance_reflection', isSelfReflective: true, reason: 'Self-performance or progress reflection.' }
  }

  return { kind: 'none', isSelfReflective: false, reason: 'Self-reference detected but no safe reflective intent established.' }
}
