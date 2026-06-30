import { NextRequest, NextResponse } from 'next/server'
import { SEED_EMAIL, resetPassword } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/reset-password
 *
 * Temporary admin reset endpoint. For now ONLY allows resetting the password
 * for the seed operator account (`antonio.can2022@hotmail.com`). The caller
 * supplies { email, newPassword }; we verify the email matches the seed user
 * before re-hashing the new password into the DB.
 *
 * This is intentionally simple — there's only one user in this demo.
 */
export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const email = (body?.email ?? '').toString().trim().toLowerCase()
  const newPassword = (body?.newPassword ?? '').toString()

  if (!email || !newPassword) {
    return NextResponse.json(
      { ok: false, error: 'Both email and newPassword are required.' },
      { status: 400 }
    )
  }
  if (newPassword.length < 8) {
    return NextResponse.json(
      { ok: false, error: 'New password must be at least 8 characters.' },
      { status: 400 }
    )
  }
  if (newPassword.length > 200) {
    return NextResponse.json(
      { ok: false, error: 'New password is too long.' },
      { status: 400 }
    )
  }
  // SECURITY: only allow resetting the seed user via this endpoint.
  if (email !== SEED_EMAIL) {
    return NextResponse.json(
      { ok: false, error: 'This endpoint can only reset the seed operator account.' },
      { status: 403 }
    )
  }

  const ok = await resetPassword(email, newPassword)
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: 'User not found. The seed account may not exist yet.' },
      { status: 404 }
    )
  }
  return NextResponse.json({ ok: true, message: 'Password reset successfully.' })
}
