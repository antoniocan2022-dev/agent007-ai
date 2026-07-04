import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword, SEED_EMAIL } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/force-reset
 * Resets password to default. Does NOT call ensureDbReady (prevents data loss on Vercel).
 * Only resets the password — no data is deleted.
 */
export async function POST() {
  try {
    const user = await db.user.findUnique({ where: { email: SEED_EMAIL } }).catch(() => null)
    if (!user) {
      // User doesn't exist — create with default password (no table creation)
      try {
        const passwordHash = await hashPassword(SEED_EMAIL)
        await db.user.create({ data: { email: SEED_EMAIL, passwordHash, name: 'Agent007 Operator' } })
      } catch {}
      return NextResponse.json({ ok: true, message: `User created. Sign in with "${SEED_EMAIL}" / "${SEED_EMAIL}".` })
    }
    // User exists — just reset password
    const passwordHash = await hashPassword(SEED_EMAIL)
    await db.user.update({ where: { id: user.id }, data: { passwordHash } })
    return NextResponse.json({ ok: true, message: `Password reset. Sign in with "${SEED_EMAIL}" / "${SEED_EMAIL}".` })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'Reset failed' }, { status: 500 })
  }
}
