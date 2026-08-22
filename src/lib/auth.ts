import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { db } from '@/lib/db'
import { SEED_EMAIL, getOwnerBootstrapPassword } from '@/lib/owner-config'

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
        const configuredPassword = getOwnerBootstrapPassword()
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

const PASSWORD_RESET_KEY_PREFIX = 'password_reset:'
const PASSWORD_RESET_TTL_MS = 10 * 60 * 1000
const PASSWORD_RESET_RESEND_COOLDOWN_MS = 60 * 1000
const MIN_PASSWORD_LENGTH = 8

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function isStrongEnoughPassword(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH
}

function hashResetCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex')
}

function passwordResetKey(userId: string): string {
  return `${PASSWORD_RESET_KEY_PREFIX}${userId}`
}

export async function requestPasswordReset(email: string): Promise<{ sent: boolean; retryAfterSeconds?: number }> {
  const normalized = normalizeEmail(email)
  if (!normalized) return { sent: true }

  const user = await db.user.findUnique({ where: { email: normalized } })
  if (!user) {
    // Deliberately do not reveal whether the account exists.
    return { sent: true }
  }

  const key = passwordResetKey(user.id)
  const existing = await db.userSetting.findFirst({ where: { userId: user.id, key } })
  if (existing) {
    try {
      const parsed = JSON.parse(existing.value) as { issuedAt?: number }
      const issuedAt = Number(parsed.issuedAt ?? 0)
      const remaining = PASSWORD_RESET_RESEND_COOLDOWN_MS - (Date.now() - issuedAt)
      if (remaining > 0) {
        return { sent: false, retryAfterSeconds: Math.ceil(remaining / 1000) }
      }
    } catch {
      // Ignore malformed stale state and replace it below.
    }
  }

  const code = crypto.randomInt(100000, 1000000).toString()
  const issuedAt = Date.now()
  const expiresAt = issuedAt + PASSWORD_RESET_TTL_MS
  const value = JSON.stringify({ codeHash: hashResetCode(code), issuedAt, expiresAt })

  await db.userSetting.upsert({
    where: { userId_key: { userId: user.id, key } },
    update: { value },
    create: { userId: user.id, key, value },
  })

  const { sendEmail } = await import('@/lib/email')
  const result = await sendEmail({
    to: user.email,
    subject: 'Agent007 password reset code',
    body: `Your Agent007 password reset code is: ${code}\n\nThis code expires in 10 minutes.\n\nIf you did not request a password reset, you can safely ignore this email.`,
    userId: user.id,
    type: 'password_reset',
  })

  if (!result.sent) {
    await db.userSetting.deleteMany({ where: { userId: user.id, key } }).catch(() => {})
  }

  return { sent: result.sent }
}

export async function confirmPasswordReset(email: string, code: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  const normalized = normalizeEmail(email)
  if (!normalized || !/^\d{6}$/.test(code)) return { ok: false, error: 'Invalid reset code.' }
  if (!isStrongEnoughPassword(newPassword)) return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }

  const user = await db.user.findUnique({ where: { email: normalized } })
  if (!user) return { ok: false, error: 'Invalid reset code.' }

  const key = passwordResetKey(user.id)
  const stored = await db.userSetting.findFirst({ where: { userId: user.id, key } })
  if (!stored) return { ok: false, error: 'Invalid or expired reset code.' }

  try {
    const parsed = JSON.parse(stored.value) as { codeHash?: string; expiresAt?: number }
    const expiresAt = Number(parsed.expiresAt ?? 0)
    const storedHash = typeof parsed.codeHash === 'string' ? parsed.codeHash : ''
    const suppliedHash = hashResetCode(code)
    if (!storedHash || Date.now() >= expiresAt || storedHash.length !== suppliedHash.length || !crypto.timingSafeEqual(Buffer.from(storedHash), Buffer.from(suppliedHash))) {
      return { ok: false, error: 'Invalid or expired reset code.' }
    }

    const passwordHash = await hashPassword(newPassword)
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } })
      await tx.userSetting.deleteMany({ where: { userId: user.id, key } })
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'password_reset',
          entity: 'auth',
          description: 'Password reset successfully with one-time email code',
        },
      })
    })

    return { ok: true }
  } catch (error) {
    console.error('[auth] confirmPasswordReset failed:', error)
    return { ok: false, error: 'Unable to reset password right now.' }
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
