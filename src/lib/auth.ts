import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { SEED_EMAIL } from '@/lib/owner-config'

/**
 * The single authorized operator of Agent007 AI.
 * Owner/bootstrap data is provisioned by the controlled bootstrap script.
 * Runtime authentication never creates a predictable-password account.
 */
export { SEED_EMAIL }

export async function hashPassword(pw: string): Promise<string> {
  const salt = await bcrypt.genSalt(12)
  return bcrypt.hash(pw, salt)
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(pw, hash)
  } catch {
    return false
  }
}

let seedPromise: Promise<void> | null = null

/**
 * Compatibility hook used by existing auth callers.
 *
 * Runtime authentication never creates an account with a default/password-equals-email
 * credential. Account creation belongs to scripts/bootstrap-owner-data.ts and requires
 * OWNER_BOOTSTRAP_PASSWORD explicitly.
 */
export function ensureSeedUser(): Promise<void> {
  if (!seedPromise) {
    seedPromise = (async () => {
      try {
        const existing = await db.user.findUnique({ where: { email: SEED_EMAIL } })
        if (existing) return

        const configuredPassword = process.env.OWNER_BOOTSTRAP_PASSWORD?.trim()
        if (!configuredPassword) return

        const passwordHash = await hashPassword(configuredPassword)
        await db.user.create({
          data: { email: SEED_EMAIL, passwordHash, name: 'Agent007 Operator' },
        })
      } catch (e: any) {
        console.error('[auth] ensureSeedUser failed:', e?.message ?? String(e))
      }
    })()
  }
  return seedPromise
}

export async function resetPassword(email: string, newPassword: string): Promise<boolean> {
  try {
    const normalized = email.trim().toLowerCase()
    const user = await db.user.findUnique({ where: { email: normalized } })
    if (!user) return false
    const passwordHash = await hashPassword(newPassword)
    await db.user.update({ where: { id: user.id }, data: { passwordHash } })
    return true
  } catch (e) {
    console.error('[auth] resetPassword failed:', e)
    return false
  }
}

function getNextAuthSecret(): string {
  const configured = process.env.NEXTAUTH_SECRET?.trim()
  if (configured) return configured

  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return 'agent007-build-only-placeholder-secret-do-not-use-at-runtime'
  }

  throw new Error('NEXTAUTH_SECRET is required at runtime. Configure it in Vercel for Preview and Production.')
}

export const authOptions: NextAuthOptions = {
  secret: getNextAuthSecret(),
  session: {
    strategy: 'jwt',
    maxAge: 60 * 60 * 24 * 30,
  },
  pages: {
    signIn: '/login',
  },
  ...(typeof window === 'undefined' && process.env.ENABLE_IFRAME_COOKIES === 'true'
    ? {
        cookies: {
          sessionToken: {
            name: 'next-auth.session-token',
            options: { httpOnly: true, sameSite: 'none', path: '/', secure: true },
          },
          callbackUrl: {
            name: 'next-auth.callback-url',
            options: { sameSite: 'none', path: '/', secure: true },
          },
          csrfToken: {
            name: 'next-auth.csrf-token',
            options: { httpOnly: true, sameSite: 'none', path: '/', secure: true },
          },
        },
      }
    : {}),
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email', placeholder: 'operator@example.com' },
        password: { label: 'Password', type: 'password' },
        twofaVerified: { label: '2FA verified', type: 'text' },
      },
      async authorize(credentials) {
        await ensureSeedUser()

        const email = credentials?.email?.trim().toLowerCase()
        const password = credentials?.password ?? ''
        if (!email || !password) return null

        const user = await db.user.findUnique({ where: { email } })
        if (!user) return null

        const valid = await verifyPassword(password, user.passwordHash)
        if (!valid) return null

        const twofaVerified = credentials?.twofaVerified === 'true'
        if (!twofaVerified) {
          try {
            const enabledTwoFactor = await db.twoFactorSecret.findFirst({
              where: { userId: user.id, enabled: true },
            })
            if (enabledTwoFactor) {
              const err = new Error('2FA_REQUIRED') as any
              err.code = '2FA_REQUIRED'
              err.userId = user.id
              throw err
            }
          } catch (e: any) {
            if (e?.code === '2FA_REQUIRED') throw e
            console.error('[auth] 2FA check failed:', e?.message)
            return null
          }
        }

        return { id: user.id, email: user.email, name: user.name ?? user.email }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as any).id
        token.email = (user as any).email
        token.name = (user as any).name ?? (user as any).email
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        ;(session.user as any).id = token.id
        ;(session.user as any).email = token.email
        ;(session.user as any).name = token.name
      }
      return session
    },
  },
}
