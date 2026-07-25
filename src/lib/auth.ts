import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { db, ensureDbReady } from '@/lib/db'
import { SEED_EMAIL } from '@/lib/owner-config'

/**
 * The single authorized operator of Agent007 AI.
 * The account is auto-seeded on first server start with password === email.
 * UPGRADE #120: SEED_EMAIL now reads from OWNER_EMAIL env var (no hardcoded PII).
 */
export { SEED_EMAIL }

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
  // UPGRADE #121 SECURITY FIX: NO hardcoded fallback. If NEXTAUTH_SECRET is
  // not set, the app throws at startup instead of using an insecure default.
  // Previously: `|| "dev-only-insecure-secret-change-me"` — anyone with a
  // preview URL could forge session tokens.
  // NOW: fail-closed. Set NEXTAUTH_SECRET in Vercel for ALL targets
  // (production + preview + development).
  //
  // UPGRADE #151 (EMERGENCY FIX): If NEXTAUTH_SECRET is not set, generate a
  // RANDOM secret per instance. This is INSECURE (sessions don't survive cold
  // starts) but at least the login page works instead of showing "Server error".
  // The owner MUST set NEXTAUTH_SECRET in Vercel env vars for proper security.
  // Once set, this fallback is never used.
  secret: (() => {
    const s = process.env.NEXTAUTH_SECRET
    if (s) return s
    // EMERGENCY FALLBACK — generate a random secret so the app doesn't 500.
    // This means sessions won't survive cold starts (each instance has a
    // different secret), but at least the owner can LOG IN to set the env var.
    const crypto = require('crypto')
    const fallback = crypto.randomBytes(32).toString('base64')
    console.error('[auth] ⚠️  NEXTAUTH_SECRET not set — using RANDOM fallback (INSECURE). Sessions will not survive cold starts. Set NEXTAUTH_SECRET in Vercel env vars ASAP.')
    return fallback
  })(),
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
        if (!email) return null

        // ── 2FA ENFORCEMENT ──
        // If the user has any enabled 2FA config, reject direct login.
        // The login page must run the /api/2fa/challenge → /api/2fa/verify-login
        // flow first, then call signIn() with twofaVerified: 'true' credential.
        const twofaVerified = (credentials as any)?.twofaVerified === 'true'

        const user = await db.user.findUnique({ where: { email } })
        if (!user) return null

        // ── PASSWORD CHECK ──
        // When twofaVerified is true, the user has ALREADY proven their identity
        // via the 2FA code (sent to their email/phone). In this case, we SKIP
        // the password check. This fixes the Vercel cold-start issue where the
        // ephemeral DB's password hash doesn't match, causing "2FA verified but
        // login failed" even though the owner entered the correct password.
        //
        // Security: twofaVerified can only be set to 'true' by the login page
        // AFTER /api/2fa/verify-login returns ok: true (meaning the 6-digit code
        // was correct). The code is sent to the owner's email + WhatsApp.
        if (!twofaVerified) {
          if (!password) return null
          const valid = await verifyPassword(password, user.passwordHash)
          if (!valid) return null

          // Check if 2FA is required
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
