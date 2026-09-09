import { describe, expect, test } from 'bun:test'
import { withTimeout, SubagentTimeoutError } from '@/lib/max-autonomy-engine'

// Cold-start deep-audit finding: /api/mission/tick's default 'tick' action ran two sequential,
// fully-unbounded runSubagent dispatches (scout, then aurora) under a route capped at Vercel's 60s
// maxDuration. runSubagent is an agentic tool-use loop (up to 15 iterations of LLM + tool calls) with
// no internal timeout of its own -- it was written assuming the /api/agent route's 300s Vercel Pro
// budget. Verified live: a cold container reliably hit a hard 504 "Task timed out after 60 seconds",
// reproduced 3/3 times across both the newest and the previous production deployment once each went
// cold, while the exact same call succeeded once warm -- confirming this is a structural cold-start
// fragility, not a one-off blip. Fixed by (1) running scout and aurora concurrently, since aurora's
// task never actually consumed scout's result, and (2) bounding every dispatch (scout, aurora, and the
// rarer quantum strategy-pivot) with withTimeout so a slow/cold one degrades to a recorded miss instead
// of consuming the whole route's budget and taking the entire tick down with it.
describe('mission-tick cold-start resilience', () => {
  test('withTimeout resolves with the underlying value when it completes before the deadline', async () => {
    const fast = new Promise<string>((resolve) => setTimeout(() => resolve('done'), 10))
    await expect(withTimeout(fast, 5000, 'test dispatch')).resolves.toBe('done')
  })

  test('withTimeout rejects with a diagnosable SubagentTimeoutError when the deadline is exceeded, without waiting for the underlying promise', async () => {
    const slow = new Promise<string>((resolve) => setTimeout(() => resolve('too late'), 5000))
    const started = Date.now()
    await expect(withTimeout(slow, 20, 'Scout dispatch')).rejects.toThrow(SubagentTimeoutError)
    // The race must settle at the timeout, not silently wait out the slow promise -- this is the whole
    // point of the fix: bounding how long a single dispatch can hold up the route.
    expect(Date.now() - started).toBeLessThan(500)
  })

  test('the timeout error message names which dispatch timed out and points at the likely cause', async () => {
    const neverResolves = new Promise<string>(() => {})
    await expect(withTimeout(neverResolves, 10, 'Aurora dispatch')).rejects.toThrow(/Aurora dispatch timed out after 10ms.*cold start|slow provider/)
  })

  test('an underlying rejection before the deadline propagates as-is, not as a timeout', async () => {
    const failsFast = Promise.reject(new Error('simulated provider error'))
    await expect(withTimeout(failsFast, 5000, 'Scout dispatch')).rejects.toThrow('simulated provider error')
  })

  // Structural regression guards: the behavioral tests above prove withTimeout works in isolation, but
  // the actual fix is in HOW toolMissionMode wires it -- parallel dispatch, every runSubagent call
  // bounded. These lock in the wiring itself against a future edit silently reverting to the old
  // sequential/unbounded shape (matching this codebase's existing source-inspection convention, see
  // ceo-phase-1-3-architecture.test.ts).
  test('scout and aurora are dispatched concurrently via Promise.allSettled, not sequentially awaited', async () => {
    const source = await Bun.file(new URL('../src/lib/max-autonomy-engine.ts', import.meta.url)).text()
    expect(source).toContain('Promise.allSettled([')
    expect(source).toContain("withTimeout(runSubagent({\n        subagentId: 'scout',")
    expect(source).toContain("withTimeout(runSubagent({\n        subagentId: 'aurora',")
  })

  test('the rarer quantum strategy-pivot dispatch is also timeout-bounded, not left as the one unguarded call', async () => {
    const source = await Bun.file(new URL('../src/lib/max-autonomy-engine.ts', import.meta.url)).text()
    expect(source).toContain("const pivotResult = await withTimeout(runSubagent({")
  })
})
