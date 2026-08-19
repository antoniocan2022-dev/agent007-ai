import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync('scripts/bootstrap-owner-data.ts', 'utf8')

describe('owner bootstrap security invariants', () => {
  test('never derives a password from the owner email', () => {
    expect(source).not.toContain('bcrypt.hash(SEED_EMAIL, 10)')
    expect(source).not.toContain('passwordHash: SEED_EMAIL')
    expect(source).toContain("const BOOTSTRAP_PASSWORD_ENV = 'OWNER_BOOTSTRAP_PASSWORD'")
    expect(source).toContain('process.env[BOOTSTRAP_PASSWORD_ENV]')
    expect(source).toContain('${BOOTSTRAP_PASSWORD_ENV} must be set when creating the owner account.')
  })

  test('legacy predictable passwords require explicit replacement', () => {
    expect(source).toContain('bcrypt.compare(SEED_EMAIL, existingUser.passwordHash)')
    expect(source).toContain('return bcrypt.hash(configuredPassword, 12)')
  })

  test('bootstrap never marks email 2FA verified without an actual verification event', () => {
    expect(source).toContain('enabled: false')
    expect(source).toContain('verifiedAt: null')
    expect(source).not.toContain('verifiedAt: new Date()')
  })
})
