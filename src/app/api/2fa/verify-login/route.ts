import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import crypto from 'node:crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getAuthSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET?.trim()
  if (!secret) throw new Error('NEXTAUTH_SECRET is required for 2FA.')
  return secret
}

function verifySignedToken(userId: string, code: string, token: string, expiresAt: number): boolean {
  if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) return false
  const payload = `${userId}:${code}:${expiresAt}`
  const expectedToken = crypto.createHmac('sha256', getAuthSecret()).update(payload).digest('hex')
  if (token.length !== expectedToken.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken))
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const userId = body?.userId?.toString().trim()
    const code = body?.code?.toString().trim()
    const token = body?.token?.toString().trim()
    const expiresAt = Number(body?.expiresAt)

    if (!userId || !/^\d{6}$/.test(code || '') || !token || !Number.isFinite(expiresAt)) {
      return NextResponse.json({ error: 'Invalid verification request.' }, { status: 400 })
    }

    if (!verifySignedToken(userId, code, token, expiresAt)) {
      return NextResponse.json({ error: 'Invalid or expired verification code.' }, { status: 400 })
    }

    const challengeKey = `2fa_challenge:${userId}`
    const challengeValue = JSON.stringify({ code, expiresAt })
    const consumed = await db.userSetting.deleteMany({
      where: { key: challengeKey, userId, value: challengeValue },
    })

    if (consumed.count !== 1) {
      return NextResponse.json({ error: 'Verification code has already been used. Request a new code.' }, { status: 400 })
    }

    await db.auditLog.create({
      data: {
        userId,
        action: '2fa_verified',
        entity: 'auth',
        description: '2FA verified via one-time signed challenge',
      },
    }).catch(() => {})

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[2fa/verify-login] failed:', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: 'Unable to verify code.' }, { status: 500 })
  }
}
