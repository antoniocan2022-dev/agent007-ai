import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const loginSource = readFileSync(new URL('../src/app/login/page.tsx', import.meta.url), 'utf8')
const challengeSource = readFileSync(new URL('../src/app/api/2fa/challenge/route.ts', import.meta.url), 'utf8')
const verifySource = readFileSync(new URL('../src/app/api/2fa/verify-login/route.ts', import.meta.url), 'utf8')
const authSource = readFileSync(new URL('../src/lib/auth.ts', import.meta.url), 'utf8')
const ownerConfigSource = readFileSync(new URL('../src/lib/owner-config.ts', import.meta.url), 'utf8')

describe('authentication hardening', () => {
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

  test('correct password can transition to 2FA, while challenge never receives only an email', () => {
    expect(loginSource).toContain("body: JSON.stringify({ email: normalizedEmail, password: rawPassword })")
    expect(loginSource).toContain("'Two-Factor Verification'")
    expect(loginSource).toContain("'Verification code sent to your email.'")
    expect(loginSource).toContain('twofaProof: verification.proofToken')
    expect(loginSource).toContain('twofaProofExpiresAt: String(verification.proofExpiresAt)')
    expect(challengeSource).toContain('verifyPassword(password, user.passwordHash)')
    expect(challengeSource).toContain("return genericAuthFailure()")
    expect(challengeSource).not.toContain('db.user.create')
    expect(challengeSource).not.toContain('displayCode')
    expect(challengeSource).not.toContain('agent007-fallback-secret')
  })

  test('2FA challenge is consumed once and returns a short-lived login proof', () => {
    expect(verifySource).toContain('deleteMany')
    expect(verifySource).toContain('consumed.count !== 1')
    expect(verifySource).toContain('proofToken: proof.token')
    expect(verifySource).toContain('proofExpiresAt: proof.expiresAt')
  })

  test('runtime auth requires signed proof when 2FA is enabled and bootstrap secret access is centralized', () => {
    expect(authSource).not.toContain("twofaVerified = credentials?.twofaVerified")
    expect(authSource).toContain('verifyTwoFactorLoginProof')
    expect(authSource).toContain('twofaProofExpiresAt')
    expect(authSource).toContain('timingSafeEqual')
    expect(authSource).not.toContain('hashPassword(SEED_EMAIL)')
    expect(authSource).toContain('getOwnerBootstrapPassword')
    expect(authSource).not.toContain('process.env.OWNER_BOOTSTRAP_PASSWORD')
    expect(ownerConfigSource).toContain('getOwnerBootstrapPassword')
    expect(ownerConfigSource).toContain('OWNER_BOOTSTRAP_PASSWORD')
  })
})
