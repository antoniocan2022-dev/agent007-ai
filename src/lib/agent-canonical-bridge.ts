import { runCeoCognitiveLifecycle } from './ceo-cognitive-lifecycle'
import { runCanonicalLlm } from './canonical-llm-router'
import { getOrchestrationOwner } from './ceo-execution-owner'
import { getProviderTaskPolicy, type ProviderTaskPolicy } from './provider-intelligence-policy'
import type { TaskType, VerificationTier } from './subagent-governance'
import { getCanonicalOrganizationPrompt } from './canonical-organization-prompt'

/**
 * Canonical compatibility bridge.
 *
 * CEO-owned requests enter the governed CEO cognitive lifecycle. Requests
 * already owned by the operational orchestrator use the canonical provider
 * runtime directly instead of recursively re-entering the CEO lifecycle.
 * This preserves one authoritative orchestration owner per request while
 * keeping the legacy completion shape stable for existing callers.
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

function buildLegacyResult(result: any, startedAt: number, policyTaskClass?: TaskType) {
  const policy: ProviderTaskPolicy | undefined = policyTaskClass
    ? getProviderTaskPolicy(policyTaskClass)
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

export async function callLlmWithRetry(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  opts?: CanonicalBridgeOptions,
): Promise<any> {
  const startedAt = Date.now()
  const owner = getOrchestrationOwner()
  const normalizedMessages = withCanonicalOrganization(messages)

  if (owner === 'operational_orchestrator') {
    const result = await runCanonicalLlm({
      messages: normalizedMessages,
      taskType: opts?.taskType ?? 'reasoning',
      verification: opts?.verification ?? 'standard',
      thinking: opts?.thinking,
      model: opts?.model,
      temperature: opts?.temperature ?? 0.2,
      maxTokens: opts?.maxTokens ?? 4000,
      timeoutMs: Math.max(1000, Math.min(60000, opts?.timeoutMs ?? 30000)),
      executionClass: 'standard',
      maxProviderAttempts: 5,
    })

    return buildLegacyResult(result, startedAt, opts?.taskType)
  }

  const result = await runCeoCognitiveLifecycle({
    messages: normalizedMessages,
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

  return buildLegacyResult(result, startedAt, result.decisionPlan.taskClass)
}
