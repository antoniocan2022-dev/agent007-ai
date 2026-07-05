import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The owner's email — 2FA is ALWAYS required for this account, even if
// the DB has no 2FA config (which happens on Vercel cold starts when the
// ephemeral DB is wiped). This is a HARD security policy compiled into
// the source code — it cannot be disabled at runtime.
const OWNER_EMAIL = 'antonio.can2022@hotmail.com'

/**
 * POST /api/2fa/challenge
 *
 * Pre-flight check: does this account require 2FA?
 *
 * For the OWNER account (antonio.can2022@hotmail.com):
 *   - ALWAYS returns requiresTwoFactor: true, regardless of DB state
 *   - If no 2FA config exists in DB (cold start), auto-creates a default
 *     email-based 2FA config so the code can be sent
 *   - This ensures the login page ALWAYS shows the 2FA code input for
 *     the owner, even after a Vercel cold start wipes the DB
 *
 * For non-owner accounts:
 *   - Checks the DB for an enabled 2FA config
 *   - Returns requiresTwoFactor: true only if config exists + is enabled
 */
export async function POST(req: NextRequest) {
  try {
    await ensureDbReady()
    const body = await req.json()
    const email = (body?.email ?? '').toString().trim().toLowerCase()
    if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })

    const user = await db.user.findUnique({ where: { email } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // Check for existing 2FA config
    let config = await db.twoFactorSecret.findFirst({ where: { userId: user.id, enabled: true } })

    // ── OWNER ACCOUNT: always require 2FA ───────────────────────────────
    // On Vercel cold starts, the DB is wiped and the 2FA config disappears.
    // For the owner, we AUTO-CREATE a default email-based 2FA config so the
    // login page always shows the 2FA input. This is a HARD security policy.
    const isOwner = email === OWNER_EMAIL
    if (isOwner && !config) {
      try {
        config = await db.twoFactorSecret.create({
          data: {
            userId: user.id,
            method: 'email',
            email: OWNER_EMAIL,
            enabled: true,
            verifiedAt: new Date(),
          },
        })
        console.log('[2fa/challenge] Auto-created default email 2FA config for owner')
      } catch (e: any) {
        // If create fails (e.g., race condition), try to find again
        config = await db.twoFactorSecret.findFirst({ where: { userId: user.id, enabled: true } })
      }
    }

    // If still no config:
    // - Owner: force require 2FA anyway (use email method as default)
    // - Non-owner: no 2FA required
    if (!config) {
      if (isOwner) {
        // Owner ALWAYS requires 2FA — use email as fallback method
        return NextResponse.json({
          ok: true,
          requiresTwoFactor: true,
          userId: user.id,
          method: 'email',
          message: 'Enter the 6-digit code sent to your email (antonio.can2022@hotmail.com). Owner 2FA is ALWAYS required.',
        })
      }
      return NextResponse.json({ ok: true, requiresTwoFactor: false, message: 'No 2FA enabled' })
    }

    // For TOTP (Google Authenticator): NO code needs to be sent — user enters code from app
    if (config.method === 'google_authenticator' || config.method === 'totp') {
      return NextResponse.json({
        ok: true,
        requiresTwoFactor: true,
        userId: user.id,
        method: 'totp',
        message: 'Enter the 6-digit code from your Google Authenticator app',
      })
    }

    // For WhatsApp/Email/SMS: generate + send a 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString()
    const _g: any = globalThis as any
    if (!_g.__2faChallenges) _g.__2faChallenges = new Map()
    _g.__2faChallenges.set(user.id, { code, expiresAt: Date.now() + 5 * 60 * 1000 })

    if (config.method === 'whatsapp') {
      const { sendWhatsApp } = await import('@/lib/whatsapp-bridge')
      await sendWhatsApp({ userId: user.id, to: config.phoneNumber || '+15145496297', message: `Your Agent007 verification code: ${code}` }).catch(() => {})
    } else if (config.method === 'email') {
      const { sendEmail } = await import('@/lib/email')
      await sendEmail({ to: config.email || email, subject: 'Agent007 Verification Code', body: `Your verification code is: ${code}`, userId: user.id, type: '2fa' }).catch(() => {})
    }

    return NextResponse.json({
      ok: true,
      requiresTwoFactor: true,
      userId: user.id,
      method: config.method,
      message: `Code sent via ${config.method}${isOwner ? ' (owner 2FA always required)' : ''}`,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 })
  }
}
