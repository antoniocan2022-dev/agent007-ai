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
 *
 * runOwnerAwareLlm (below) is that owner-based fork. It is deliberately not
 * a raw provider-calling utility -- it decides how much governance a turn
 * needs (a full multi-stage CEO cognitive lifecycle vs. a direct inference
 * call), which is an orchestration decision, not a provider-mechanics one.
 * That decision belongs at this layer, above the provider gateway
 * (canonical-llm-router.ts / provider-runtime-v2.ts), which never
 * references orchestration ownership at all.
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

// Provider Gateway Phase B (2026-09-19): renamed from callLlmWithRetry. This file's line 17 (`export *
// from './agent'`) already re-exports agent.ts's OWN, genuinely different callLlmWithRetry -- a local
// declaration under the identical name here was shadowing that re-export for every caller importing
// from this file, which is exactly the "two functions with the same name doing different things"
// footgun a fresh architecture audit flagged (agent.ts always calls runCanonicalLlm directly and
// reshapes the result into an OpenAI chat-completion object; this one branches on
// getOrchestrationOwner() and returns runCanonicalLlm's/runCeoCognitiveLifecycle's own result shape
// unchanged). Renaming resolves the ambiguity by construction instead of leaving it to a doc comment:
// callLlmWithRetry now unambiguously means agent.ts's version everywhere, including when re-exported
// from this bridge file.
export async function runOwnerAwareLlm(
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
