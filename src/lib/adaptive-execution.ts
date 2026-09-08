/**
 * Adaptive Execution Architecture.
 *
 * Classifies the latest user intent into a latency profile without reducing
 * governance, model quality, evidence requirements, or provider safeguards.
 * The profile only removes unnecessary orchestration overhead for simple work
 * and preserves the deep path for complex or mission-level work.
 */

import { classifyCeoSelfReflection, type SelfReflectionClassification } from './ceo-self-reflection'

export type ExecutionClass = 'fast' | 'standard' | 'deep' | 'mission'

export interface AdaptiveExecutionPlan {
  executionClass: ExecutionClass
  reason: string
  maxProviderAttempts: number
  maxTokens: number
  timeoutMs: number
  parallelizable: boolean
}

const GREETING_RE = /^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening)|thanks|thank\s+you|thx|ok|okay|great|perfect|goodbye|bye|how\s+do\s+you\s+do)[!.?\s]*$/i
const MISSION_ACTION_RE = /\b(deploy|production\s+change|launch|publish|send|buy|sell|invest|transfer|commit|execute|run|implement|fix|refactor|create\s+(a|an)\s+(mission|venture|artifact|campaign)|start\s+(a|the)\s+mission)\b/i
const MISSION_CONTEXT_RE = /\b(mission|autonom(?:y|ous)|venture|revenue|customer|transaction|production)\b/i
const DEEP_RE = /\b(deep|detailed|comprehensive|compare|comparison|strategy|strategic|architecture|analyze|analysis|diagnose|research|evidence|verify|verification|evaluate|plan|design|security|financial|legal|optimi[sz]e|root\s+cause)\b/i
const FAST_RE = /\b(what is|what's|who is|where is|when is|how much|how many|define|meaning of|translate|calculate|can you|could you|is it|are you)\b/i
const CONTEXT_DEPENDENT_RE = /\b(this|that|these|those|it|they|them|above|previous|prior|continue|again|same|more|also|instead|as before)\b/i
// A short question ("List 5 reasons this failed") can still ask for several structured items --
// the fast lane's budget is sized for one short answer, not N. Requires an actual count (digit or
// number word), not just the word "list", so a genuinely single-item request ("List the priority")
// still gets classified on length alone rather than being promoted every time.
//
// Deep-audit fix: the trigger-to-count gap was originally {0,40} chars, wide enough to false-positive
// on ordinary sentences like "her name is Sarah, we have 3 pending items" or "the company name is
// listed under 5 different filings" -- "name" followed, well within 40 chars, by an unrelated later
// digit. Every real enumeration phrasing this detector needs to catch (tested below) puts the count
// directly adjacent to the trigger word (a 1-2 char gap: "list 5", "give me three", "name four"), so
// tightening the gap to {0,10} removes that false-positive class while still matching every real case.
//
// Deep-audit fix (found via independent adversarial review, then confirmed directly): the first
// alternative has no requirement that the count refer to a listable item, so "Give me 5 minutes to think
// about this" / "Give me three hours to finish this" also matched -- a time allowance, not an
// enumeration request. Excludes the clearest, most common such class (a following time-duration unit)
// rather than requiring an exhaustive noun list on this alternative, which the second alternative
// already does for its own narrower phrasing ("N reasons/ways/examples/...").
const ENUMERATION_RE = /\b(?:list|name|give\s+me|provide|enumerate|show\s+me)\b(?:[^.?!]{0,10})?\b(?:\d+|two|three|four|five|six|seven|eight|nine|ten)\b(?!\s*(?:minutes?|seconds?|hours?|days?|weeks?|months?|years?))|\b(?:\d+|two|three|four|five|six|seven|eight|nine|ten)\b\s+(?:reasons|ways|examples|options|ideas|steps|factors|items|things|points|strategies|approaches|benefits|risks|alternatives)\b/i

function latestUserMessage(messages: readonly { role: string; content: string }[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return String(messages[index].content ?? '').trim()
  }
  return ''
}

export function classifyExecution(
  messages: readonly { role: string; content: string }[],
  precomputedSelfReflection?: SelfReflectionClassification,
): AdaptiveExecutionPlan {
  const text = latestUserMessage(messages)
  const normalized = text.replace(/\s+/g, ' ').trim()

  if (!normalized) return { executionClass: 'fast', reason: 'No substantive user request detected.', maxProviderAttempts: 1, maxTokens: 400, timeoutMs: 8000, parallelizable: false }
  if (GREETING_RE.test(normalized)) return { executionClass: 'fast', reason: 'Greeting or acknowledgement requires no deep orchestration.', maxProviderAttempts: 1, maxTokens: 400, timeoutMs: 8000, parallelizable: false }

  const selfReflection = precomputedSelfReflection ?? classifyCeoSelfReflection(normalized)
  if (selfReflection.isSelfReflective) {
    return {
      executionClass: 'fast',
      reason: `CEO self-reflection (${selfReflection.kind}) uses the bounded CEO lifecycle and is not promoted by deep-work keywords.`,
      maxProviderAttempts: 4,
      maxTokens: 4000,
      timeoutMs: 30000,
      parallelizable: false,
    }
  }

  const missionContext = MISSION_CONTEXT_RE.test(normalized)
  const missionAction = MISSION_ACTION_RE.test(normalized)
  if (missionAction || (missionContext && DEEP_RE.test(normalized))) {
    return { executionClass: 'mission', reason: 'Governed external, business, production, or mission execution request detected.', maxProviderAttempts: 4, maxTokens: 8000, timeoutMs: 60000, parallelizable: true }
  }

  if (normalized.length > 800 || DEEP_RE.test(normalized)) {
    return { executionClass: 'deep', reason: 'Complex reasoning, research, verification, architecture, or analysis request detected.', maxProviderAttempts: 4, maxTokens: 8000, timeoutMs: 60000, parallelizable: true }
  }

  if (CONTEXT_DEPENDENT_RE.test(normalized)) {
    return { executionClass: 'standard', reason: 'Request contains context-dependent language; preserve the standard conversational path.', maxProviderAttempts: 3, maxTokens: 4000, timeoutMs: 30000, parallelizable: false }
  }

  if (ENUMERATION_RE.test(normalized)) {
    return { executionClass: 'standard', reason: 'Request asks for multiple structured items; a short question does not imply a short answer.', maxProviderAttempts: 3, maxTokens: 4000, timeoutMs: 30000, parallelizable: false }
  }

  // maxTokens/timeoutMs raised from 1200/15000 (2026-09): a short question routinely deserves a
  // substantive answer -- a real production transcript showed a fully legitimate reply hitting this
  // exact ceiling and getting cut off mid-sentence. DEEP_RE and the >800-char check above already
  // promote genuinely complex requests to the 8000-token lane; this lane is specifically short
  // requests that stayed short because the QUESTION is short, not because the answer should be.
  if (normalized.length <= 220 && FAST_RE.test(normalized)) {
    return { executionClass: 'fast', reason: 'Short informational request can use the low-overhead governed lane.', maxProviderAttempts: 2, maxTokens: 2400, timeoutMs: 20000, parallelizable: false }
  }

  if (normalized.length <= 280) {
    return { executionClass: 'fast', reason: 'Short request without deep-work indicators.', maxProviderAttempts: 2, maxTokens: 2400, timeoutMs: 20000, parallelizable: false }
  }

  return { executionClass: 'standard', reason: 'Normal request requiring standard governed model execution.', maxProviderAttempts: 3, maxTokens: 4000, timeoutMs: 30000, parallelizable: true }
}

export function shouldUseFastLane(plan: AdaptiveExecutionPlan, attachmentsCount: number): boolean {
  return plan.executionClass === 'fast' && attachmentsCount === 0
}

export function isDeepExecution(executionClass: ExecutionClass): boolean {
  return executionClass === 'deep' || executionClass === 'mission'
}
