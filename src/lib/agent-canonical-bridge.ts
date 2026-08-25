import { runCeoCognitiveLifecycle } from './ceo-cognitive-lifecycle'
import { getProviderTaskPolicy, type ProviderTaskPolicy } from './provider-intelligence-policy'
import type { TaskType, VerificationTier } from './subagent-governance'
import { getCanonicalOrganizationPrompt } from './canonical-organization-prompt'

/**
 * Canonical compatibility bridge.
 * Existing modules retain the legacy completion shape, while CEO-facing LLM
 * requests now pass through the bounded cognitive lifecycle and receive the
 * same canonical organization facts enforced by the authority layer.
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

function withCanonicalOrganization(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) {
  const organization = getCanonicalOrganizationPrompt()
  const index = messages.findIndex((message) => message.role === 'system')
  if (index === -1) return [{ role: 'system' as const, content: organization }, ...messages]
  return messages.map((message, messageIndex) => messageIndex === index
    ? { ...message, content: `${message.content}\n\n${organization}` }
    : message)
}

export async function callLlmWithRetry(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  opts?: CanonicalBridgeOptions,
): Promise<any> {
  const startedAt = Date.now()
  const result = await runCeoCognitiveLifecycle({
    messages: withCanonicalOrganization(messages),
    attachmentsCount: opts?.attachmentsCount,
    missionId: opts?.missionId,
    contextualEvidence: opts?.contextualEvidence,
    taskType: opts?.taskType,
    verification: opts?.verification,
    model: opts?.model,
    temperature: opts?.temperature,
    maxTokens: opts?.maxTokens,
    timeoutMs: opts?.timeoutMs,
  })

  const policy: ProviderTaskPolicy | undefined = result.decisionPlan.taskClass
    ? getProviderTaskPolicy(result.decisionPlan.taskClass)
    : undefined

  return {
    choices: [{ message: { content: result.content }, finish_reason: 'stop' }],
    content: result.content,
    provider: result.provider,
    model: result.model,
    attempts: result.attempts,
    responseMs: result.responseMs || Date.now() - startedAt,
    policy,
    executionPlan: result.executionPlan,
    decisionPlan: result.decisionPlan,
    quality: result.quality,
    evidenceState: result.evidenceState,
    degraded: result.degraded,
  }
}
