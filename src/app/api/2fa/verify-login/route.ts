import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/2fa/verify-login
 *
 * Verify the 2FA code. The challenge is stored in the DB (not in-memory)
 * so it survives across Vercel serverless instances.
 */
export async function POST(req: NextRequest) {
  try {
    await ensureDbReady()
    const body = await req.json()
    const { userId, code } = body
    if (!userId || !code) return NextResponse.json({ error: 'userId and code required' }, { status: 400 })

    // Read the challenge from the DB (not in-memory — Vercel is stateless)
    const challengeKey = `2fa_challenge:${userId}`
    let challenge: any = null
    try {
      const row = await db.userSetting.findFirst({ where: { key: challengeKey } })
      if (row) {
        try { challenge = JSON.parse(row.value) } catch { challenge = null }
      }
    } catch {}

    // Fallback: also check in-memory (for local dev)
    if (!challenge) {
      const _g: any = globalThis as any
      const challenges = _g.__2faChallenges
      if (challenges && challenges.has(userId)) {
        challenge = challenges.get(userId)
      }
    }

    if (!challenge) {
      return NextResponse.json({ error: 'No challenge found. Request a new code.' }, { status: 400 })
    }

    // Check expiry
    if (Date.now() > challenge.expiresAt) {
      // Clean up expired challenge
      try {
        const row = await db.userSetting.findFirst({ where: { key: challengeKey } })
        if (row) await db.userSetting.delete({ where: { id: row.id } })
      } catch {}
      const _g: any = globalThis as any
      _g.__2faChallenges?.delete?.(userId)
      return NextResponse.json({ error: 'Code expired. Request a new code.' }, { status: 400 })
    }

    // Verify the code
    if (code !== challenge.code) {
      return NextResponse.json({ error: 'Invalid code' }, { status: 400 })
    }

    // Clean up the challenge (used)
    try {
      const row = await db.userSetting.findFirst({ where: { key: challengeKey } })
      if (row) await db.userSetting.delete({ where: { id: row.id } })
    } catch {}
    const _g: any = globalThis as any
    _g.__2faChallenges?.delete?.(userId)

    // Log the verification
    try {
      await db.auditLog.create({
        data: {
          userId,
          action: '2fa_verified',
          entity: 'auth',
          description: '2FA challenge verified successfully',
        },
      })
    } catch {}

    return NextResponse.json({ ok: true, message: '2FA verified' })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 })
  }
}
