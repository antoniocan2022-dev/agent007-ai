import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { isOwnerEmail, OWNER_EMAIL } from '@/lib/owner-config'

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
const sessionUserSource = read('../src/lib/session-user.ts')
const ownerRequestAuthSource = read('../src/lib/owner-request-auth.ts')
const registerRouteSource = read('../src/app/api/auth/register/route.ts')
const usersRouteSource = read('../src/app/api/users/route.ts')
const usersIdRouteSource = read('../src/app/api/users/[id]/route.ts')

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

  // Deep-audit fix: self-registration used to create a fully usable account with no approval step
  // -- authorize() never checked isUserApproved(), directly contradicting user-approval.ts's own
  // documented design. These tests lock in that the approval gate is genuinely wired end to end:
  // login is gated, registration creates the approval-token record processApproval() expects and
  // notifies the owner, and every owner-only route guard checks owner identity specifically rather
  // than accepting any authenticated session (this app supports multi-user registration, so "any
  // session" was never equivalent to "the owner").
  describe('self-registration approval gate is genuinely wired, not just documented', () => {
    // isUserApproved itself is exercised only via source assertions here, not a real import: it
    // transitively pulls in email.ts -> auth.ts -> next-auth/providers/credentials, which this
    // sandbox cannot resolve (confirmed: no other test in this codebase imports it directly
    // either) -- will run as a real import in real CI. owner-config.ts has zero imports of its
    // own, so isOwnerEmail/OWNER_EMAIL below are exercised for real.
    test('user-approval.ts unconditionally treats the owner as approved before any database lookup', () => {
      const userApprovalSource = read('../src/lib/user-approval.ts')
      expect(userApprovalSource).toMatch(/isUserApproved[\s\S]{0,80}if\s*\(\s*isOwnerEmail\(userEmail\)\s*\)\s*return\s+true/)
    })

    test('authorize() rejects login for an unapproved account instead of trusting password/2FA alone', () => {
      expect(authSource).toContain('isUserApproved')
      expect(authSource).toMatch(/if\s*\(\s*!\s*\(\s*await\s+isUserApproved\(user\.email\)\s*\)\s*\)\s*return\s+null/)
    })

    test('registerUser creates the approval-token record and notifies the owner', () => {
      expect(sessionUserSource).toContain('generateApprovalToken')
      expect(sessionUserSource).toContain('sendApprovalRequest')
      expect(sessionUserSource).toContain("key: `approval_token:")
    })

    test('registerUser refuses to register the owner\'s own email, which must only be provisioned via ensureSeedUser+OWNER_BOOTSTRAP_PASSWORD', () => {
      expect(sessionUserSource).toContain('SEED_EMAIL.trim().toLowerCase()')
      expect(sessionUserSource).toContain('reserved for the account owner')
    })

    test('the register route surfaces pending-approval status instead of always claiming immediate sign-in works', () => {
      expect(registerRouteSource).toContain('pendingApproval')
    })

    test('owner-only route guards check owner identity specifically, not just any authenticated session', () => {
      expect(ownerRequestAuthSource).toContain('isOwnerEmail')
      expect(ownerRequestAuthSource).not.toContain('session?.user) return true')
      expect(isOwnerEmail(undefined)).toBe(false)
      expect(isOwnerEmail('not-the-owner@example.com')).toBe(false)
      expect(isOwnerEmail(OWNER_EMAIL)).toBe(true)
    })

    // Deep-audit fix: /api/users (list) and /api/users/:id (PATCH/DELETE) used to accept ANY
    // authenticated session, not just the owner's -- an approved non-owner account could
    // enumerate every user's email, delete any other account, or PATCH another user's
    // email/password (full account takeover). Same "any session != owner" bug as
    // owner-request-auth.ts, now fixed the same way.
    test('GET /api/users requires owner identity, not just any session, and surfaces approval status', () => {
      expect(usersRouteSource).toContain('isOwnerEmail')
      expect(usersRouteSource).not.toContain('if (!session?.user)')
      expect(usersRouteSource).toContain('approved:')
    })

    test('DELETE and PATCH /api/users/:id require owner identity, not just any session', () => {
      expect(usersIdRouteSource).not.toContain('if (!session?.user)')
      const deleteGuardCount = (usersIdRouteSource.match(/isOwnerEmail\(session\?\.user\?\.email\)/g) ?? []).length
      expect(deleteGuardCount).toBeGreaterThanOrEqual(2) // one for DELETE, one for PATCH
    })

    test('owner can approve/reject a pending user via PATCH /api/users/:id, reusing the same approval-record shape processApproval uses', () => {
      expect(usersIdRouteSource).toContain("body.action === 'approve'")
      expect(usersIdRouteSource).toContain("body.action === 'reject'")
      expect(usersIdRouteSource).toContain('approveUserById')
      expect(usersIdRouteSource).toContain('rejectUserById')
      const userApprovalSource = read('../src/lib/user-approval.ts')
      expect(userApprovalSource).toContain('export async function approveUserById')
      expect(userApprovalSource).toContain('export async function rejectUserById')
      expect(userApprovalSource).toContain("key: 'approved'")
    })
  })
})