import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { db } from '@/lib/db'
import { SEED_EMAIL } from '@/lib/owner-config'

export { SEED_EMAIL }

export async function hashPassword(pw: string): Promise<string> {
  const salt = await bcrypt.genSalt(12)
  return bcrypt.hash(pw, salt)
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  try { return await bcrypt.compare(pw, hash) } catch { return false }
}

let seedPromise: Promise<void> | null = null

export function ensureSeedUser(): Promise<void> {
  if (!seedPromise) {
    seedPromise = (async () => {
      try {
        const existing = await db.user.findUnique({ where: { email: SEED_EMAIL } })
        if (existing) return
        const configuredPassword = process.env.OWNER_BOOTSTRAP_PASSWORD?.trim()
        if (!configuredPassword) return
        const passwordHash = await hashPassword(configuredPassword)
        await db.user.create({ data: { email: SEED_EMAIL, passwordHash, name: 'Agent007 Operator' } })
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
  if (process.env.NEXT_PHASE === 'phase-production-build') return 'agent007-build-only-placeholder-secret-do-not-use-at-runtime'
  throw new Error('NEXTAUTH_SECRET is required at runtime. Configure it in Vercel for Preview and Production.')
}

function verifyTwoFactorLoginProof(userId: string, token: string, expiresAtInput: number): boolean {
  const secret = process.env.NEXTAUTH_SECRET?.trim()
  if (!secret || !token || !Number.isFinite(expiresAtInput) || Date.now() >= expiresAtInput) return false
  if (expiresAtInput - Date.now() > 60 * 1000) return false

  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8')
    const parts = decoded.split(':')
    if (parts.length !== 5) return false
    const [proofUserId, purpose, proofExpiresAtRaw, nonce, signature] = parts
    const proofExpiresAt = Number(proofExpiresAtRaw)
    if (proofUserId !== userId || purpose !== '2fa' || proofExpiresAt !== expiresAtInput || !nonce || !Number.isFinite(proofExpiresAt)) return false
    const payload = `${proofUserId}:${purpose}:${proofExpiresAt}:${nonce}`
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex')
    if (signature.length !== expected.length) return false
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    return false
  }
}

export const authOptions: NextAuthOptions = {
  secret: getNextAuthSecret(),
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: '/login' },
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email', placeholder: 'operator@example.com' },
        password: { label: 'Password', type: 'password' },
        twofaProof: { label: '2FA proof', type: 'text' },
        twofaProofExpiresAt: { label: '2FA proof expiry', type: 'text' },
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

        const enabledTwoFactor = await db.twoFactorSecret.findFirst({ where: { userId: user.id, enabled: true } })
        if (enabledTwoFactor) {
          const proof = credentials?.twofaProof?.toString() ?? ''
          const proofExpiresAt = Number(credentials?.twofaProofExpiresAt?.toString() ?? '')
          if (!verifyTwoFactorLoginProof(user.id, proof, proofExpiresAt)) return null
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
