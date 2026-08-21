import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

describe('Vercel build integrity', () => {
  test('canonical build script is deployment-root portable and non-destructive', () => {
    const script = readFileSync(new URL('../scripts/vercel-build.sh', import.meta.url), 'utf8')
    expect(script).not.toContain('cd /home/z/my-project')
    expect(script).toContain('$(pwd)')
    expect(script).toContain('prisma generate')
    expect(script).toContain('bun run db:reconcile')
    expect(script).not.toContain('prisma db push --accept-data-loss')
    expect(script).toContain('bun run db:bootstrap')
    expect(script).toContain('bun run build')
  })

  test('Vercel uses the canonical build script', () => {
    const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
    expect(config.buildCommand).toBe('bash scripts/vercel-build.sh')
    expect(config.git?.deploymentEnabled).toBe(true)
  })
})
