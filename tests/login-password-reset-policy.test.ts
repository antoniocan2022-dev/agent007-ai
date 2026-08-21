import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const loginSource = readFileSync(new URL('../src/app/login/page.tsx', import.meta.url), 'utf8')
const resetRouteSource = readFileSync(new URL('../src/app/api/auth/password-reset/route.ts', import.meta.url), 'utf8')
const authSource = readFileSync(new URL('../src/lib/auth.ts', import.meta.url), 'utf8')

 describe('login and password reset release contract', () => {
  test('login exposes the password reset path and preserves 2FA login', () => {
    expect(loginSource).toContain('Forgot password? / Reset password')
    expect(loginSource).toContain("/api/auth/password-reset")
    expect(loginSource).toContain('/api/2fa/challenge')
    expect(loginSource).toContain('/api/2fa/verify-login')
    expect(loginSource).toContain("signIn('credentials'")
  })

  test('reset endpoint supports request and confirmation actions without user enumeration', () => {
    expect(resetRouteSource).toContain("action === 'request'")
    expect(resetRouteSource).toContain("action === 'confirm'")
    expect(resetRouteSource).toContain('If an account exists for that email')
    expect(resetRouteSource).toContain('checkRateLimitAsync')
  })

  test('reset codes are hashed, short-lived, single-use and passwords are bcrypt-hashed', () => {
    expect(authSource).toContain('crypto.createHash(\'sha256\')')
    expect(authSource).toContain('PASSWORD_RESET_TTL_MS = 10 * 60 * 1000')
    expect(authSource).toContain('crypto.timingSafeEqual')
    expect(authSource).toContain('tx.userSetting.deleteMany')
    expect(authSource).toContain('hashPassword(newPassword)')
  })
})
