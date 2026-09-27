import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

// Deep-audit fix: fresh review of Stages 5-7 found two real bugs neither the original tests nor the
// full regression suite could catch, because this sandbox has no live database to exercise the actual
// mission-crash/retry flow end-to-end. Pinned here as static-source-text invariants (the same pattern
// this repo already uses for its other architecture-boundary checks) so a future edit can't silently
// reintroduce either one.
describe('mission-pipeline auto-retry safety invariants', () => {
  test('sweepMissionPipelineAutoRetries never calls resumeMissionPipeline (would bypass the owner-approval gate)', () => {
    // resumeMissionPipeline unconditionally sets skipOwnerApproval: true, under the assumption that
    // its only real caller (/api/missions/[id]/approve) only ever invokes it right after the owner
    // has actually approved. A crash-triggered auto-retry has no relationship to owner approval --
    // reusing that function would let a requiresOwnerApproval pipeline (e.g. product_launch, "involves
    // money + public launch") sail straight through its CEO-stage approval gate on any transient
    // network-error retry.
    // Checks for actual invocation (an import destructure or a call), not prose -- this file's own
    // header/inline comments legitimately explain, in words, why resumeMissionPipeline is NOT used,
    // including the literal phrase "skipOwnerApproval: true" describing what it does elsewhere.
    const source = read('src/lib/mission-pipeline-recovery.ts')
    expect(source).not.toMatch(/\{\s*resumeMissionPipeline\s*\}|resumeMissionPipeline\(/)
    expect(source).toMatch(/\{\s*runMissionPipeline\s*\}/)
    const callSiteStart = source.indexOf('await runMissionPipeline({')
    const callSiteEnd = source.indexOf('})', callSiteStart)
    expect(callSiteStart).toBeGreaterThan(-1)
    const callSiteArgs = source.slice(callSiteStart, callSiteEnd)
    expect(callSiteArgs).not.toMatch(/skipOwnerApproval\s*:/)
  })

  test('runMissionPipeline carries forward autoRetryCount from the prior heartbeat instead of resetting it on every run', () => {
    // The initial heartbeat write at the top of runMissionPipeline runs on every invocation, including
    // a Stage 5 auto-retry. If it always reset autoRetryCount to 0, the bounded-retry guarantee in
    // mission-pipeline-recovery.ts would never actually accumulate past 1 -- a permanently broken
    // mission could retry forever instead of eventually becoming durably fatal.
    const source = read('src/lib/mission-pipeline.ts')
    const initialHeartbeatBlock = source.slice(source.indexOf('const initialHeartbeat: MissionHeartbeat'), source.indexOf('await saveHeartbeat(initialHeartbeat)'))
    expect(initialHeartbeatBlock).toContain('priorHeartbeatForRetryBudget?.autoRetryCount ?? 0')
    expect(source.indexOf('const priorHeartbeatForRetryBudget = await loadHeartbeat(missionId)')).toBeLessThan(source.indexOf('const initialHeartbeat: MissionHeartbeat'))
  })
})
