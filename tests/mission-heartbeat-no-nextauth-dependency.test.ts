import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

// Deploy incident (2026-09-27): the Venture OS 24x7 Heartbeat's GitHub Actions job has no reason to
// carry NEXTAUTH_SECRET and doesn't -- it's a background cron script, not a NextAuth request handler.
// mission-pipeline-recovery.ts's sweepMissionPipelineAutoRetries (wired into that same heartbeat via
// autonomy-manager.ts's includeMissionPipelineSupervisor) dynamically imports mission-heartbeat.ts,
// which imports settings.ts, which imported SEED_EMAIL from '@/lib/auth' -- and importing @/lib/auth
// for ANY reason executes its module-level `authOptions` construction, which calls
// getNextAuthSecret() eagerly and throws if NEXTAUTH_SECRET isn't configured. That crashed the real
// production heartbeat the moment this path first ran. Fixed by importing SEED_EMAIL from
// @/lib/seed-user directly (zero dependency on next-auth), matching the isolation auth.ts's own
// comment already establishes for exactly this hazard.
//
// Reproduces the actual incident in a subprocess with NEXTAUTH_SECRET deliberately unset, importing
// the real module chain the heartbeat exercises -- a static source-text check alone couldn't catch a
// reintroduction through a different file in the same chain.
describe('mission-heartbeat.ts import chain has no NEXTAUTH_SECRET dependency', () => {
  test('importing mission-heartbeat.ts (as sweepMissionPipelineAutoRetries does) never throws when NEXTAUTH_SECRET is unset', async () => {
    const env = { ...process.env }
    delete env.NEXTAUTH_SECRET
    const proc = Bun.spawn({
      cmd: ['bun', '-e', "import('./src/lib/mission-heartbeat.ts').then(() => { console.log('OK'); process.exit(0) }).catch((e) => { console.error(e?.message ?? String(e)); process.exit(1) })"],
      cwd: new URL('..', import.meta.url).pathname,
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    expect(stderr).not.toContain('NEXTAUTH_SECRET')
    expect(stdout).toContain('OK')
    expect(exitCode).toBe(0)
  })

  test('settings.ts imports SEED_EMAIL from seed-user.ts, never from @/lib/auth', () => {
    const source = readFileSync(new URL('../src/lib/settings.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/SEED_EMAIL.*from ['"]@\/lib\/auth['"]/)
    expect(source).toMatch(/SEED_EMAIL.*from ['"]@\/lib\/seed-user['"]/)
  })
})
