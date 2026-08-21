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
    expect(auth).not.toContain('resetPassword(')
    expect(auth).not.toContain('db.user.update({ where: { id: user.id }, data: { passwordHash')
  })

  it('runs the owner bootstrap only from the controlled Vercel release build', () => {
    expect(build).toContain('bun run db:bootstrap')
    expect(build).toContain('OWNER_BOOTSTRAP_PASSWORD')
    expect(build).toContain('Postgres detected')
  })
})
