""import { runCanonicalLlm } from './canonical-llm-router'
import type { TaskType, VerificationTier } from './subagent-governance'

/**
 * Canonical compatibility bridge.
 *
 * Existing Agent007 modules can continue importing the parsing, prompt, memory,
 * and orchestration helpers they need from `@/lib/agent`, while the actual LLM
 * transport is replaced by the governed provider-runtime-v2 engine.
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
""