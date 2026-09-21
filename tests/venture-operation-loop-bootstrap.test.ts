import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

// Production incident (2026-09-21): scripts/run-venture-operation-cycle.ts (the 24x7 scheduled
// heartbeat -- the ONLY production caller of runVentureOperationCycle, run unattended by GitHub
// Actions with no HTTP session) called resolveVentureOrganizationScope(ventureId) directly.
// That function requires venture_001's relational Venture/BusinessUnit identity to already exist,
// but the only code path that ever created it was the owner-authenticated POST /api/ventures/001
// endpoint -- so the scheduled heartbeat could never succeed even once unless a human had
// separately logged in and hit that endpoint. Fixed by bootstrapping Venture 001's identity inside
// the cycle itself, idempotently, using the same seed/owner account ensureSeedUser() already
// provisions -- no HTTP session required.
describe('Venture operation cycle self-bootstraps Venture 001 (no manual login required)', () => {
  test('runVentureOperationCycle bootstraps Venture 001 before resolving its organization scope', () => {
    const source = read('src/lib/venture-operation-loop.ts')
    expect(source).toContain("import { ensureVenture001, VENTURE_001_REFERENCE } from './venture-001'")
    const bootstrapIndex = source.indexOf('ensureVenture001BootstrappedForCycle(ventureId, findings)')
    const resolveScopeIndex = source.indexOf('resolveVentureOrganizationScope(ventureId)')
    expect(bootstrapIndex).toBeGreaterThan(-1)
    expect(resolveScopeIndex).toBeGreaterThan(-1)
    expect(bootstrapIndex).toBeLessThan(resolveScopeIndex)
    // Bootstrap must not require an HTTP session -- resolves the seed/owner account directly by
    // email, the same fallback path session-user.ts's getSessionUserId() already uses.
    expect(source).toContain('ensureSeedUser')
    expect(source).not.toContain('getServerSession')
  })

  // The 24x7 heartbeat's own CI gate (venture-os-24x7-heartbeat.yml, "Verify operation-loop and
  // autonomy contracts") requires these exact tokens to remain present -- locked here too so a
  // local regression run catches drift before CI does.
  test('required operation-loop/autonomy contract tokens remain intact', () => {
    const source = read('src/lib/venture-operation-loop.ts')
    for (const token of [
      "import { runAutonomyManagerTick } from './autonomy/autonomy-manager'",
      'export async function runVentureOperationCycle(',
      'runAutonomyManagerTick(',
      'includeMissionSupervisor: true',
      'RECOVERABLE',
    ]) {
      expect(source).toContain(token)
    }
    const managerCalls = source.split('runAutonomyManagerTick(').length - 1
    expect(managerCalls).toBe(1)
  })
})

// Production incident (2026-09-21): this cycle always computed `mode` from the real,
// evidence-driven autonomy-graduation decision, but only ever wrote it into this cycle's own
// checkpoint record (venture-os:operation:${ventureId}) -- never into the separate
// venture-os:v2:autonomy-lease:${ventureId} record operational-kpi-engine.ts actually reads for
// the CEO self-assessment's "autonomy"/"leaseHealthy" fields. Confirmed by grep: nothing in the
// automated path ever called acquireAutonomyLease/heartbeatAutonomyLease, so the self-assessment
// showed "autonomy PAUSED (lease unhealthy)" permanently regardless of the real graduation state.
describe('Venture operation cycle syncs the real autonomy decision into the lease record the self-assessment reads', () => {
  test('runVentureOperationCycle re-acquires the autonomy lease with the graduation-derived mode after computing it', () => {
    const source = read('src/lib/venture-operation-loop.ts')
    expect(source).toContain("import { acquireAutonomyLease } from './venture-autonomy-control'")
    const modeIndex = source.indexOf('const mode = autonomyModeForLevel(autonomy.level)')
    const syncIndex = source.indexOf('await acquireAutonomyLease(ventureId, mode,')
    expect(modeIndex).toBeGreaterThan(-1)
    expect(syncIndex).toBeGreaterThan(-1)
    expect(modeIndex).toBeLessThan(syncIndex)
    // The sync must fail open (never crash the whole cycle) and never use the raw caller-supplied
    // `owner` param, which differs across callers (the heartbeat's env var vs. a dashboard user's
    // authenticated email) and would otherwise make the lease's ownership check fight itself.
    expect(source).toMatch(/try\s*\{\s*await acquireAutonomyLease\(ventureId, mode,/)
    expect(source).not.toMatch(/acquireAutonomyLease\(ventureId, mode, owner[,)]/)
  })
})
