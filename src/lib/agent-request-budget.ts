import { isCeoRequestAborted } from './ceo-cancellation'

export const AGENT_REQUEST_BUDGET_MS = 210_000

export class AgentRequestTimeoutError extends Error {
  readonly code = 'AGENT_REQUEST_TIMEOUT'
  readonly timeoutMs: number

  constructor(timeoutMs = AGENT_REQUEST_BUDGET_MS) {
    super(`Agent request exceeded the ${Math.round(timeoutMs / 1000)} second execution budget.`)
    this.name = 'AgentRequestTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

export interface AgentRequestBudget {
  signal: AbortSignal
  cancel: () => void
}

export function createAgentRequestBudget(timeoutMs = AGENT_REQUEST_BUDGET_MS, parentSignal?: AbortSignal): AgentRequestBudget {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new AgentRequestTimeoutError(timeoutMs)), timeoutMs)
  const onParentAbort = () => controller.abort(parentSignal?.reason)

  if (parentSignal?.aborted) onParentAbort()
  else parentSignal?.addEventListener('abort', onParentAbort, { once: true })

  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer)
      parentSignal?.removeEventListener('abort', onParentAbort)
    },
  }
}

export async function runWithAgentRequestBudget<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs = AGENT_REQUEST_BUDGET_MS, parentSignal?: AbortSignal): Promise<T> {
  const budget = createAgentRequestBudget(timeoutMs, parentSignal)
  const workPromise = Promise.resolve().then(() => work(budget.signal))
  workPromise.catch(() => undefined)

  let onAbort: (() => void) | undefined
  const abortPromise = new Promise<never>((_, reject) => {
    onAbort = () => {
      const reason = budget.signal.reason
      if (reason instanceof AgentRequestTimeoutError) reject(reason)
      else if (isCeoRequestAborted(reason)) reject(reason)
      else if (parentSignal?.aborted) reject(parentSignal.reason)
      else reject(new AgentRequestTimeoutError(timeoutMs))
    }
    budget.signal.addEventListener('abort', onAbort, { once: true })
  })

  try {
    if (budget.signal.aborted) {
      const reason = budget.signal.reason
      if (reason instanceof AgentRequestTimeoutError) throw reason
      if (isCeoRequestAborted(reason)) throw reason
      throw new AgentRequestTimeoutError(timeoutMs)
    }
    return await Promise.race([workPromise, abortPromise])
  } finally {
    if (onAbort) budget.signal.removeEventListener('abort', onAbort)
    budget.cancel()
  }
}