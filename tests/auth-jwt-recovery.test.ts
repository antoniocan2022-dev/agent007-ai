import { describe, expect, test } from 'bun:test'
import { encode } from 'next-auth/jwt'

process.env.NEXTAUTH_SECRET = 'ci-agent007-auth-secret-for-jwt-recovery-tests'

const { authOptions } = await import('@/lib/auth')

const decode = authOptions.jwt?.decode
if (!decode) throw new Error('authOptions.jwt.decode must be configured')

describe('NextAuth JWT session recovery', () => {
  test('valid JWTs continue to decode normally', async () => {
    const secret = process.env.NEXTAUTH_SECRET!
    const token = await encode({
      token: { sub: 'user-1', email: 'ci@example.com', name: 'CI User' },
      secret,
      maxAge: 60 * 60,
    })

    const decoded = await decode({ token, secret, maxAge: 60 * 60 })

    expect(decoded?.sub).toBe('user-1')
    expect(decoded?.email).toBe('ci@example.com')
  })

  test('stale or corrupted JWTs fail closed as anonymous sessions', async () => {
    const decoded = await decode({
      token: 'not-a-valid-nextauth-jwt',
      secret: process.env.NEXTAUTH_SECRET!,
      maxAge: 60 * 60,
    })

    expect(decoded).toBeNull()
  })
})
