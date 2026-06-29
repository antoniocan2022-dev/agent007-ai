import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'

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
 * Ensures the seed operator account exists.
 * Idempotent + deduped — safe to call from the NextAuth route handler on every
 * cold start. The first invocation creates the user; subsequent ones are no-ops.
 */
export function ensureSeedUser(): Promise<void> {
  if (!seedPromise) {
    seedPromise = (async () => {
      try {
        const existing = await db.user.findUnique({ where: { email: SEED_EMAIL } })
        if (existing) return
        const passwordHash = await hashPassword(SEED_EMAIL)
        await db.user.create({
          data: {
            email: SEED_EMAIL,
            passwordHash,
            name: 'Agent007 Operator',
          },
        })
      } catch (e) {
        // Reset so a future call can retry; log for visibility.
        seedPromise = null
        console.error('[auth] ensureSeedUser failed:', e)
      }
    })()
  }
  return seedPromise
}

/* --------------------------- next-auth options --------------------------- */

export const authOptions: NextAuthOptions = {
  session: {
    strategy: 'jwt',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
  pages: {
    signIn: '/login',
  },
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
