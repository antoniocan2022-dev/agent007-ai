import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { db } from '@/lib/db'
import { verifyPassword } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getAuthSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET?.trim()
  if (!secret) throw new Error('NEXTAUTH_SECRET is required for 2FA.')
  return secret
}

function createSignedToken(userId: string, code: string, expiresAt: number): string {
  const payload = `${userId}:${code}:${expiresAt}`
  return crypto.createHmac('sha256', getAuthSecret()).update(payload).digest('hex')
}

function genericAuthFailure() {
  return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 })
}

/**
 * POST /api/2fa/challenge
 *
 * This endpoint may only issue a 2FA challenge after the supplied password has
 * already been verified. It never creates users, never resets passwords, and
 * never returns the verification code to the browser.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const email = body?.email?.toString().trim().toLowerCase()
    const password = body?.password?.toString() ?? ''
    if (!email || !password) return genericAuthFailure()

    const user = await db.user.findUnique({ where: { email } })
    if (!user || !(await verifyPassword(password, user.passwordHash))) return genericAuthFailure()

    const config = await db.twoFactorSecret.findFirst({
      where: { userId: user.id, enabled: true },
    })

    // Correct password + no enabled 2FA means the normal sign-in should have
    // succeeded. Do not create or mutate any auth state here.
    if (!config) return genericAuthFailure()

    if (config.method === 'google_authenticator' || config.method === 'totp') {
      return NextResponse.json({
        ok: true,
        requiresTwoFactor: true,
        userId: user.id,
        method: 'totp',
        message: 'Enter the 6-digit code from your authenticator app.',
      })
    }

    const code = crypto.randomInt(100000, 1000000).toString()
    const expiresAt = Date.now() + 5 * 60 * 1000
    const challengeData = { code, expiresAt }

    // Persist the challenge so verification survives Vercel instance changes.
    await db.userSetting.deleteMany({ where: { key: `2fa_challenge:${user.id}` } })
    await db.userSetting.create({
      data: {
        userId: user.id,
        key: `2fa_challenge:${user.id}`,
        value: JSON.stringify(challengeData),
      },
    })

    const token = createSignedToken(user.id, code, expiresAt)
    let sent = false

    try {
      const { sendEmail } = await import('@/lib/email')
      const result = await sendEmail({
        to: config.email || user.email,
        subject: 'Agent007 verification code',
        body: `Your Agent007 verification code is: ${code}\n\nThis code expires in 5 minutes.\n\nIf you did not request this, ignore this email.`,
        userId: user.id,
        type: '2fa',
      })
      sent = result?.sent ?? false
    } catch (error) {
      console.warn('[2fa/challenge] email delivery failed:', error instanceof Error ? error.message : String(error))
    }

    if (!sent) {
      return NextResponse.json(
        { ok: false, error: 'Verification code could not be delivered. Try again later.' },
        { status: 503 },
      )
    }

    return NextResponse.json({
      ok: true,
      requiresTwoFactor: true,
      userId: user.id,
      method: config.method || 'email',
      message: 'Verification code sent. Check your email and spam folder.',
      token,
      expiresAt,
    })
  } catch (error) {
    console.error('[2fa/challenge] failed:', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: 'Unable to start verification.' }, { status: 500 })
  }
}
