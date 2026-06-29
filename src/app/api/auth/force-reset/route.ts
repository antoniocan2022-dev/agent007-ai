import { NextResponse } from 'next/server'
import { SEED_EMAIL, ensureSeedUser, resetPassword } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/force-reset
 *
 * Nuclear option for "I changed my password and forgot it". Resets the seed
 * operator account's password back to the seed email (`antonio.can2022@hotmail.com`).
 * No auth required (the user is, by definition, locked out). No body required
 * either — we always reset the seed account to its default password.
 *
 * After this fires, the user can sign in with:
 *   email:    antonio.can2022@hotmail.com
 *   password: antonio.can2022@hotmail.com
 */
export async function POST() {
  // 1) Make sure the seed user exists at all (idempotent).
  await ensureSeedUser().catch((e) => {
    console.error('[force-reset] ensureSeedUser failed:', e)
  })
  // 2) Reset its password to the default (= email).
  const ok = await resetPassword(SEED_EMAIL, SEED_EMAIL)
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: 'Failed to reset password. The seed account may not exist.' },
      { status: 500 }
    )
  }
  return NextResponse.json({
    ok: true,
    message: `Password reset to default. You can now sign in with email and password equal to "${SEED_EMAIL}".`,
  })
}
