import { NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { hashPassword, SEED_EMAIL } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/force-reset
 *
 * Resets the operator's password to the seed default (email === password).
 *
 * This is NOT a system reset — it ONLY resets the password so the owner
 * can log in if they forgot their password. No data is deleted.
 * All conversations, memories, settings, sub-agents, and schedules remain.
 *
 * After reset, the owner can sign in with:
 *   Email: antonio.can2022@hotmail.com
 *   Password: antonio.can2022@hotmail.com
 *
 * The owner should then change their password via Settings → Change Password.
 */
export async function POST() {
  try {
    await ensureDbReady()

    const user = await db.user.findUnique({ where: { email: SEED_EMAIL } })
    if (!user) {
      // User doesn't exist — create with default password
      const passwordHash = await hashPassword(SEED_EMAIL)
      await db.user.create({
        data: {
          email: SEED_EMAIL,
          passwordHash,
          name: 'Agent007 Operator',
        },
      })
      return NextResponse.json({
        ok: true,
        message: `User created. You can now sign in with email "${SEED_EMAIL}" and password "${SEED_EMAIL}".`,
      })
    }

    // User exists — reset password to seed default
    const passwordHash = await hashPassword(SEED_EMAIL)
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash },
    })

    return NextResponse.json({
      ok: true,
      message: `Password reset to default. You can now sign in with email "${SEED_EMAIL}" and password "${SEED_EMAIL}".`,
    })
  } catch (e: any) {
    console.error('[force-reset]', e)
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'Reset failed' },
      { status: 500 }
    )
  }
}
