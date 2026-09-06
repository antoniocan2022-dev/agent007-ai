import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

describe('Vercel build integrity', () => {
  test('canonical build script is deployment-root portable and non-destructive', () => {
    const script = readFileSync(new URL('../scripts/vercel-build.sh', import.meta.url), 'utf8')
    expect(script).not.toContain('cd /home/z/my-project')
    expect(script).toContain('$(pwd)')
    expect(script).toContain('prisma generate')
    // Reconciliation is now a single path owned by the canonical package build: this script only
    // sets the env flag the build step reads, rather than invoking `db:reconcile` a second time.
    expect(script).toContain('AGENT007_RELEASE_SCHEMA_RECONCILE=1')
    expect(script).not.toContain('prisma db push --accept-data-loss')
    expect(script).toContain('bun run db:bootstrap')
    expect(script).toContain('bun run build')
  })

  test('Vercel uses the canonical build script', () => {
    const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
    expect(config.buildCommand).toBe('bash scripts/vercel-build.sh')
    // Deliberately manual: production deploys are triggered by hand, not by every push to main.
    expect(config.git?.deploymentEnabled).toBe(false)
  })
})
