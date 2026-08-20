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
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken))
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const userId = body?.userId?.toString()
    const code = body?.code?.toString()
    const token = body?.token?.toString()
    const expiresAt = Number(body?.expiresAt)

    if (!userId || !code) return NextResponse.json({ error: 'Verification data is incomplete.' }, { status: 400 })

    if (token && verifySignedToken(userId, code, token, expiresAt)) {
      await db.auditLog.create({
        data: {
          userId,
          action: '2fa_verified',
          entity: 'auth',
          description: '2FA verified via signed token',
        },
      }).catch(() => {})
      return NextResponse.json({ ok: true })
    }

    const challengeKey = `2fa_challenge:${userId}`
    const row = await db.userSetting.findFirst({ where: { key: challengeKey, userId } }).catch(() => null)
    if (!row) return NextResponse.json({ error: 'Verification code is invalid or expired.' }, { status: 400 })

    let challenge: { code?: string; expiresAt?: number }
    try {
      challenge = JSON.parse(row.value)
    } catch {
      challenge = {}
    }

    if (!challenge.expiresAt || Date.now() >= challenge.expiresAt) {
      await db.userSetting.delete({ where: { id: row.id } }).catch(() => {})
      return NextResponse.json({ error: 'Verification code is expired.' }, { status: 400 })
    }

    if (code !== challenge.code) return NextResponse.json({ error: 'Verification code is invalid.' }, { status: 400 })

    await db.userSetting.delete({ where: { id: row.id } }).catch(() => {})
    await db.auditLog.create({
      data: {
        userId,
        action: '2fa_verified',
        entity: 'auth',
        description: '2FA verified via persisted challenge',
      },
    }).catch(() => {})

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[2fa/verify-login] failed:', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: 'Unable to verify code.' }, { status: 500 })
  }
}
