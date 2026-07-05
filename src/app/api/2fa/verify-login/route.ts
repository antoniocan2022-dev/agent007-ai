import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import crypto from 'node:crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * STATELESS 2FA verification — no DB lookup needed.
 *
 * The challenge endpoint returns a signed token (HMAC of userId + code + expiry).
 * This endpoint verifies the token WITHOUT needing to look up the challenge in
 * the DB. This fixes the Vercel stateless issue where the verify request hits
 * a DIFFERENT serverless instance that doesn't have the ephemeral DB.
 *
 * How it works:
 * 1. Challenge endpoint generates: code, expiry, token = HMAC(secret, userId:code:expiry)
 * 2. Login page sends: { userId, code, token } to this endpoint
 * 3. This endpoint recomputes: expectedToken = HMAC(secret, userId:code:expiry)
 * 4. If token === expectedToken AND not expired → verified!
 *
 * Fallback: also checks DB + in-memory (for backward compatibility)
 */
function verifySignedToken(userId: string, code: string, token: string, expiresAt: number): boolean {
  const secret = process.env.NEXTAUTH_SECRET || 'agent007-fallback-secret'
  const expectedPayload = `${userId}:${code}:${expiresAt}`
  const expectedToken = crypto.createHmac('sha256', secret).update(expectedPayload).digest('hex')
  return token === expectedToken && Date.now() < expiresAt
}

export async function POST(req: NextRequest) {
  try {
    await ensureDbReady()
    const body = await req.json()
    const { userId, code, token, expiresAt } = body

    if (!userId || !code) {
      return NextResponse.json({ error: 'userId and code required' }, { status: 400 })
    }

    // ── PRIORITY 1: Stateless HMAC token verification (works across Vercel instances) ──
    if (token && expiresAt) {
      if (verifySignedToken(userId, code, token, parseInt(expiresAt, 10))) {
        // Token is valid + not expired → 2FA verified!
        try {
          await db.auditLog.create({
            data: {
              userId,
              action: '2fa_verified',
              entity: 'auth',
              description: '2FA verified via stateless HMAC token',
            },
          })
        } catch {}
        return NextResponse.json({ ok: true, message: '2FA verified (stateless token)' })
      }
    }

    // ── PRIORITY 2: DB lookup (fallback — may fail on Vercel if different instance) ──
    const challengeKey = `2fa_challenge:${userId}`
    let challenge: any = null
    try {
      const row = await db.userSetting.findFirst({ where: { key: challengeKey } })
      if (row) {
        try { challenge = JSON.parse(row.value) } catch { challenge = null }
      }
    } catch {}

    if (challenge) {
      if (Date.now() > challenge.expiresAt) {
        try {
          const row = await db.userSetting.findFirst({ where: { key: challengeKey } })
          if (row) await db.userSetting.delete({ where: { id: row.id } })
        } catch {}
        return NextResponse.json({ error: 'Code expired. Request a new code.' }, { status: 400 })
      }
      if (code === challenge.code) {
        // Clean up
        try {
          const row = await db.userSetting.findFirst({ where: { key: challengeKey } })
          if (row) await db.userSetting.delete({ where: { id: row.id } })
        } catch {}
        try {
          await db.auditLog.create({
            data: { userId, action: '2fa_verified', entity: 'auth', description: '2FA verified via DB challenge' },
          })
        } catch {}
        return NextResponse.json({ ok: true, message: '2FA verified (DB challenge)' })
      }
    }

    // ── PRIORITY 3: In-memory (fallback for local dev) ──
    const _g: any = globalThis as any
    const challenges = _g.__2faChallenges
    if (challenges && challenges.has(userId)) {
      const memChallenge = challenges.get(userId)
      if (Date.now() > memChallenge.expiresAt) {
        challenges.delete(userId)
        return NextResponse.json({ error: 'Code expired. Request a new code.' }, { status: 400 })
      }
      if (code === memChallenge.code) {
        challenges.delete(userId)
        try {
          await db.auditLog.create({
            data: { userId, action: '2fa_verified', entity: 'auth', description: '2FA verified via in-memory' },
          })
        } catch {}
        return NextResponse.json({ ok: true, message: '2FA verified (in-memory)' })
      }
    }

    return NextResponse.json({ error: 'No challenge found. Request a new code.' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 })
  }
}
