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

  if (normalized.length <= 220 && FAST_RE.test(normalized)) {
    return { executionClass: 'fast', reason: 'Short informational request can use the low-overhead governed lane.', maxProviderAttempts: 2, maxTokens: 1200, timeoutMs: 15000, parallelizable: false }
  }

  if (normalized.length <= 280) {
    return { executionClass: 'fast', reason: 'Short request without deep-work indicators.', maxProviderAttempts: 2, maxTokens: 1200, timeoutMs: 15000, parallelizable: false }
  }

  return { executionClass: 'standard', reason: 'Normal request requiring standard governed model execution.', maxProviderAttempts: 3, maxTokens: 4000, timeoutMs: 30000, parallelizable: true }
}

export function shouldUseFastLane(plan: AdaptiveExecutionPlan, attachmentsCount: number): boolean {
  return plan.executionClass === 'fast' && attachmentsCount === 0
}

export function isDeepExecution(executionClass: ExecutionClass): boolean {
  return executionClass === 'deep' || executionClass === 'mission'
}
