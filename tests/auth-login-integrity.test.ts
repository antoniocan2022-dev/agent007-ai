import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'

const loginSource = readFileSync(new URL('../src/app/login/page.tsx', import.meta.url), 'utf8')
const challengeSource = readFileSync(new URL('../src/app/api/2fa/challenge/route.ts', import.meta.url), 'utf8')
const verifyLoginSource = readFileSync(new URL('../src/app/api/2fa/verify-login/route.ts', import.meta.url), 'utf8')
const authSource = readFileSync(new URL('../src/lib/auth.ts', import.meta.url), 'utf8')

describe('authentication hardening', () => {
  test('unsafe public password reset endpoints are removed', () => {
    expect(existsSync(new URL('../src/app/api/auth/force-reset/route.ts', import.meta.url))).toBe(false)
    expect(existsSync(new URL('../src/app/api/auth/reset-password/route.ts', import.meta.url))).toBe(false)
  })

  test('wrong-password fallback reset is impossible from the login page', () => {
    expect(loginSource).not.toContain('/api/auth/force-reset')
    expect(loginSource).not.toContain('AUTO-RETRY')
    expect(loginSource).not.toContain('setPassword(SEED_EMAIL)')
    expect(loginSource).not.toContain('AutonomyIntelligencePanel')
  })

  test('login UI is limited to essential authentication controls', () => {
    expect(loginSource).toContain('id="agent007-email"')
    expect(loginSource).toContain('id="agent007-password"')
    expect(loginSource).toContain('SIGN IN')
    expect(loginSource).not.toContain('Create account')
    expect(loginSource).not.toContain('Forgot Password?')
    expect(loginSource).not.toContain('FULL_AUTONOMY')
  })

  test('2FA challenge cannot create accounts or issue a code before password verification', () => {
    expect(challengeSource).toContain('verifyPassword(password, user.passwordHash)')
    expect(challengeSource).toContain('return genericAuthFailure()')
    expect(challengeSource).not.toContain('db.user.create')
    expect(challengeSource).not.toContain('displayCode')
    expect(challengeSource).not.toContain('agent007-fallback-secret')
  })

  test('2FA verification requires the configured production secret', () => {
    expect(verifyLoginSource).toContain('NEXTAUTH_SECRET is required for 2FA.')
    expect(verifyLoginSource).not.toContain('agent007-fallback-secret')
  })

  test('runtime auth does not create a predictable password account', () => {
    expect(authSource).not.toContain('hashPassword(SEED_EMAIL)')
    expect(authSource).toContain('OWNER_BOOTSTRAP_PASSWORD')
  })
})
