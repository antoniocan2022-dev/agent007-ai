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

export function createAgentRequestBudget(timeoutMs = AGENT_REQUEST_BUDGET_MS): AgentRequestBudget {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new AgentRequestTimeoutError(timeoutMs))
  }, timeoutMs)

  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  }
}

export async function runWithAgentRequestBudget<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs = AGENT_REQUEST_BUDGET_MS,
): Promise<T> {
  const budget = createAgentRequestBudget(timeoutMs)
  const workPromise = Promise.resolve().then(() => work(budget.signal))

  // The current orchestrator is being migrated toward cooperative cancellation.
  // Swallow late rejection after the HTTP response has already timed out so a
  // doomed in-flight provider call cannot create an unhandled rejection.
  workPromise.catch(() => undefined)

  const timeoutPromise = new Promise<never>((_, reject) => {
    const onAbort = () => reject(new AgentRequestTimeoutError(timeoutMs))
    budget.signal.addEventListener('abort', onAbort, { once: true })
  })

  try {
    return await Promise.race([workPromise, timeoutPromise])
  } finally {
    budget.cancel()
  }
}
