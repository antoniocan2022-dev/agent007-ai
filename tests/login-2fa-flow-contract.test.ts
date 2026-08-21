import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const login = readFileSync('src/app/login/page.tsx', 'utf8')
const challenge = readFileSync('src/app/api/2fa/challenge/route.ts', 'utf8')

describe('login and 2FA flow contract', () => {
  it('does not fall through to password login after a real 2FA delivery failure', () => {
    expect(login).toContain("status: 'error'")
    expect(login).toContain("if (challenge.status === 'error')")
    expect(login).toContain('setError(challenge.message)')
    expect(login).not.toContain('const requires2FA = await startTwoFactorChallenge(normalizedEmail, password)')
  })

  it('requires password verification before issuing an email 2FA challenge', () => {
    expect(challenge).toContain('verifyPassword(password, user.passwordHash)')
    expect(challenge).toContain('Verification code could not be delivered')
    expect(challenge).not.toContain('return NextResponse.json({ ok: true, requiresTwoFactor: true, userId: user.id, code')
  })
})
