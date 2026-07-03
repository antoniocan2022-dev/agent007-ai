import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { verifyTotpCode } from '@/lib/owner-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/owner-auth/totp-verify
 * Verifies a TOTP code and enables TOTP for owner auth.
 *
 * Body: { code: "123456" }
 *
 * Returns: { ok, message }
 */
export async function POST(req: NextRequest) {
  try {
    await ensureDbReady()
    const body = await req.json().catch(() => ({}))
    const code = (body.code as string | undefined)?.toString().trim()

    if (!code || code.length !== 6 || !/^\d{6}$/.test(code)) {
      return NextResponse.json({ ok: false, error: 'Code must be 6 digits' }, { status: 400 })
    }

    const user = await db.user.findUnique({ where: { email: 'antonio.can2022@hotmail.com' } })
    if (!user) {
      return NextResponse.json({ ok: false, error: 'Operator user not found' }, { status: 404 })
    }

    const config = await db.twoFactorSecret.findFirst({
      where: { userId: user.id, method: 'google_authenticator', enabled: false },
    })
    if (!config || !config.secret) {
      return NextResponse.json({ ok: false, error: 'No pending TOTP setup. Call /api/owner-auth/totp first.' }, { status: 400 })
    }

    // Verify the code
    const valid = verifyTotpCode(code, config.secret)
    if (!valid) {
      return NextResponse.json({ ok: false, error: 'Invalid TOTP code. Make sure your device time is correct.' }, { status: 400 })
    }

    // Enable TOTP
    await db.twoFactorSecret.update({
      where: { id: config.id },
      data: { enabled: true, verifiedAt: new Date() },
    })

    // Log audit
    try {
      await db.auditLog.create({
        data: {
          userId: user.id,
          action: 'totp_enabled',
          entity: 'auth',
          description: 'Google Authenticator (TOTP) enabled for owner authorization',
        },
      })
    } catch {}

    return NextResponse.json({
      ok: true,
      message: '✅ TOTP (Google Authenticator) enabled. You can now use it for owner authorization.',
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 })
  }
}
