import { runCeoCognitiveLifecycle } from './ceo-cognitive-lifecycle'
import type { TaskType, VerificationTier } from './subagent-governance'

/**
 * Canonical compatibility bridge.
 * Existing modules retain the legacy completion shape, while CEO-facing LLM
 * requests now pass through the bounded cognitive lifecycle.
 */
export * from './agent'

export type CanonicalBridgeOptions = {
  thinking?: boolean
  taskType?: TaskType
  verification?: VerificationTier
  model?: string
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
  missionId?: string
  contextualEvidence?: string
  attachmentsCount?: number
}

export async function callLlmWithRetry(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  opts?: CanonicalBridgeOptions,
): Promise<any> {
  const result = await runCeoCognitiveLifecycle({
    messages,
    attachmentsCount: opts?.attachmentsCount,
    missionId: opts?.missionId,
    contextualEvidence: opts?.contextualEvidence,
    verification: opts?.verification,
    model: opts?.model,
    temperature: opts?.temperature,
    maxTokens: opts?.maxTokens,
    timeoutMs: opts?.timeoutMs,
  })

  return {
    choices: [{ message: { content: result.content }, finish_reason: 'stop' }],
    content: result.content,
    provider: result.provider,
    model: result.model,
    attempts: result.attempts,
    responseMs: undefined,
    policy: undefined,
    executionPlan: result.executionPlan,
    decisionPlan: result.decisionPlan,
    quality: result.quality,
    evidenceState: result.evidenceState,
    degraded: result.degraded,
  }
}
