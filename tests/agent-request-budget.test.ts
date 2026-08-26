import { describe, expect, test } from 'bun:test'
import {
  AgentRequestTimeoutError,
  runWithAgentRequestBudget,
} from '@/lib/agent-request-budget'

describe('agent request execution budget', () => {
  test('allows work that completes before the deadline', async () => {
    const result = await runWithAgentRequestBudget(
      async () => 'ok',
      100,
    )

    expect(result).toBe('ok')
  })

  test('aborts cooperative work at the deadline and returns a typed timeout', async () => {
    let observedAbort = false

    await expect(
      runWithAgentRequestBudget(
        (signal) => new Promise<string>((resolve) => {
          signal.addEventListener('abort', () => {
            observedAbort = true
            resolve('aborted')
          }, { once: true })
        }),
        10,
      ),
    ).rejects.toBeInstanceOf(AgentRequestTimeoutError)

    expect(observedAbort).toBe(true)
  })

  test('uses the configured deadline in the timeout error', async () => {
    await expect(
      runWithAgentRequestBudget(
        async () => new Promise<string>(() => undefined),
        15,
      ),
    ).rejects.toMatchObject({ code: 'AGENT_REQUEST_TIMEOUT', timeoutMs: 15 })
  })
})
