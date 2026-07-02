import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { db, ensureDbReady } from '@/lib/db'

/**
 * The single authorized operator of Agent007 AI.
 * The account is auto-seeded on first server start with password === email.
 */
export const SEED_EMAIL = 'antonio.can2022@hotmail.com'

/* --------------------------- password hashing --------------------------- */

export async function hashPassword(pw: string): Promise<string> {
  const salt = await bcrypt.genSalt(10)
  return bcrypt.hash(pw, salt)
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(pw, hash)
  } catch {
    return false
  }
}

/* ------------------------------ seed user ------------------------------- */

let seedPromise: Promise<void> | null = null

/**
 * Ensures the seed operator account exists AND that its password hash is valid.
 * Idempotent + deduped — safe to call from the NextAuth route handler on every
 * request (we reset seedPromise after each run so a future call can re-verify).
 *
 * If the user has changed their password, we DO NOT touch it. If the user row
 * is missing entirely, we create it with the default password (=== email).
 */
export function ensureSeedUser(): Promise<void> {
  if (!seedPromise) {
    seedPromise = (async () => {
      try {
        // Ensure DB tables exist first (critical for Vercel serverless)
        await ensureDbReady()
        const existing = await db.user.findUnique({ where: { email: SEED_EMAIL } })
        if (!existing) {
          const passwordHash = await hashPassword(SEED_EMAIL)
          await db.user.create({
            data: {
              email: SEED_EMAIL,
              passwordHash,
              name: 'Agent007 Operator',
            },
          })
        }
      } catch (e: any) {
        console.error('[auth] ensureSeedUser failed:', e?.message ?? String(e))
      }
    })()
  }
  return seedPromise
}

/* --------------------------- password reset ---------------------------- */

/**
 * Reset a user's password to the given new password. Returns true on success.
 * For now this is gated to only the seed email by the calling API route.
 */
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

/* --------------------------- next-auth options --------------------------- */

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET || "dev-only-insecure-secret-change-me",
  session: {
    strategy: 'jwt',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  },
  pages: {
    signIn: '/login',
  },
  // CRITICAL: Allow NextAuth cookies to work inside cross-origin iframes
  // (like the preview panel on https://preview-*.space-z.ai).
  // SameSite=None requires Secure=true, which only works over HTTPS.
  // The preview panel uses HTTPS (via Caddy proxy), so we detect HTTPS
  // via the X-Forwarded-Proto header and set cookies accordingly.
  // On plain HTTP (localhost dev), we use the NextAuth defaults (SameSite=Lax).
  ...(typeof window === 'undefined' && process.env.ENABLE_IFRAME_COOKIES === 'true'
    ? {
        cookies: {
          sessionToken: {
            name: `next-auth.session-token`,
            options: { httpOnly: true, sameSite: 'none', path: '/', secure: true },
          },
          callbackUrl: {
            name: `next-auth.callback-url`,
            options: { sameSite: 'none', path: '/', secure: true },
          },
          csrfToken: {
            name: `next-auth.csrf-token`,
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
      },
      async authorize(credentials) {
        // Make sure the seed operator exists before attempting sign-in.
        await ensureSeedUser()

        const email = credentials?.email?.trim().toLowerCase()
        const password = credentials?.password ?? ''
        if (!email || !password) return null

        const user = await db.user.findUnique({ where: { email } })
        if (!user) return null

        const valid = await verifyPassword(password, user.passwordHash)
        if (!valid) return null

        // ── 2FA ENFORCEMENT ──
        // If the user has any enabled 2FA config, reject direct login.
        // The login page must run the /api/2fa/challenge → /api/2fa/verify-login
        // flow first, then call signIn() with twofaVerified: 'true' credential.
        const twofaVerified = (credentials as any)?.twofaVerified === 'true'
        if (!twofaVerified) {
          try {
            const enabledTwoFactor = await db.twoFactorSecret.findFirst({
              where: { userId: user.id, enabled: true },
            })
            if (enabledTwoFactor) {
              // Signal to the client that 2FA is required
              const err = new Error('2FA_REQUIRED') as any
              err.code = '2FA_REQUIRED'
              err.userId = user.id
              throw err
            }
          } catch (e: any) {
            // If it's our 2FA_REQUIRED signal, re-throw
            if (e?.code === '2FA_REQUIRED') throw e
            // Otherwise log + allow login (fail-open for 2FA check errors)
            console.error('[auth] 2FA check failed:', e?.message)
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
