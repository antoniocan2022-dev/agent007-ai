import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const bootstrap = readFileSync('scripts/bootstrap-owner-data.ts', 'utf8')
const build = readFileSync('scripts/vercel-build.sh', 'utf8')
const auth = readFileSync('src/lib/auth.ts', 'utf8')

describe('owner login bootstrap contract', () => {
  it('reconciles OWNER_BOOTSTRAP_PASSWORD only in controlled bootstrap code', () => {
    expect(bootstrap).toContain("process.env[BOOTSTRAP_PASSWORD_ENV]?.trim()")
    expect(bootstrap).toContain('await db.user.upsert')
    expect(auth).not.toContain('process.env.OWNER_BOOTSTRAP_PASSWORD')
  })

  it('never reintroduces request-time password reset through auth', () => {
    expect(auth).not.toContain('export async function resetPassword')
    expect(auth).not.toContain('db.user.update({ where: { id: user.id }, data: { passwordHash')
  })

  it('runs owner bootstrap only after the controlled build contract', () => {
    expect(build).toContain('bun run db:bootstrap')
    expect(build).toContain('OWNER_BOOTSTRAP_PASSWORD')
    expect(build).toContain('AGENT007_RELEASE_SCHEMA_RECONCILE=1')
    expect(build).toContain('DATABASE_URL')

    const buildIndex = build.indexOf('bun run build')
    const bootstrapIndex = build.indexOf('bun run db:bootstrap')
    expect(buildIndex).toBeGreaterThanOrEqual(0)
    expect(bootstrapIndex).toBeGreaterThan(buildIndex)
  })
})
