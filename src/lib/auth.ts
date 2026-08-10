import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
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
    const fallback = randomBytes(32).toString('base64')
    console.error('[auth] ⚠️  NEXTAUTH_SECRET not set — using RANDOM fallback (INSECURE). Sessions will not survive cold starts. Set NEXTAUTH_SECRET in Vercel env vars ASAP.')
    return fallback
  })(),
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