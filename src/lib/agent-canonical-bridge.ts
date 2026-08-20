import { runCanonicalLlm } from './canonical-llm-router'
import type { TaskType, VerificationTier } from './subagent-governance'

/**
 * Canonical compatibility bridge.
 * Existing modules can continue importing parsing, prompt, memory, and
 * orchestration helpers from `@/lib/agent`, while LLM transport is routed
 * through the governed provider-runtime-v2 engine.
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
}

export async function callLlmWithRetry(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  opts?: CanonicalBridgeOptions,
): Promise<any> {
  return runCanonicalLlm({
    messages,
    taskType: opts?.taskType,
    verification: opts?.verification,
    thinking: opts?.thinking,
    model: opts?.model,
    temperature: opts?.temperature,
    maxTokens: opts?.maxTokens,
    timeoutMs: opts?.timeoutMs,
  })
}
