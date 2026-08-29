import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const loginSource = read('../src/app/login/page.tsx')
const challengeSource = read('../src/app/api/2fa/challenge/route.ts')
const verifySource = read('../src/app/api/2fa/verify-login/route.ts')
const authSource = read('../src/lib/auth.ts')
const ownerConfigSource = read('../src/lib/owner-config.ts')
const agentRouteSource = read('../src/app/api/agent/route.ts')
const conversationsRouteSource = read('../src/app/api/conversations/route.ts')
const conversationIdRouteSource = read('../src/app/api/conversations/[id]/route.ts')
const memoryRouteSource = read('../src/app/api/memory/route.ts')
const apiKeysRouteSource = read('../src/app/api/api-keys/route.ts')

const requiresSession = (source: string) => source.includes('getServerSession(authOptions)')

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

  test('agent and conversation APIs require authentication and enforce ownership', () => {
    expect(requiresSession(agentRouteSource)).toBe(true)
    expect(agentRouteSource).toContain('Conversation not found.')
    expect(agentRouteSource).toContain('userId: sessionUserId')
    expect(agentRouteSource).toContain('where: { id: conversationId, userId }')

    expect(requiresSession(conversationsRouteSource)).toBe(true)
    expect(conversationsRouteSource).toContain('where: { userId }')
    expect(conversationsRouteSource).toContain('data: { title, userId }')

    expect(requiresSession(conversationIdRouteSource)).toBe(true)
    expect(conversationIdRouteSource).toContain('where: { id, userId }')
    expect(conversationIdRouteSource).toContain('where: { id, userId }, select: { id: true }')
  })

  test('memory and API-key APIs require an authenticated session before data access', () => {
    expect(requiresSession(memoryRouteSource)).toBe(true)
    expect(memoryRouteSource).toContain('Authentication required.')
    expect(apiKeysRouteSource).toContain('getSessionUserId()')
    expect(apiKeysRouteSource).toContain('where: { id, userId }')
    expect(apiKeysRouteSource).toContain("error: 'Not found'")
  })
})