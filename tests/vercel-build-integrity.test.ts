import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

describe('Vercel build integrity', () => {
  test('build script is deployment-root portable and keeps DB reconciliation in the build phase', () => {
    const script = readFileSync(new URL('../scripts/vercel-build.sh', import.meta.url), 'utf8')
    expect(script).not.toContain('cd /home/z/my-project')
    expect(script).toContain('$(pwd)')
    expect(script).toContain('prisma generate')
    expect(script).toContain('prisma db push --accept-data-loss')
    expect(script).toContain('bun run build')
  })
})
