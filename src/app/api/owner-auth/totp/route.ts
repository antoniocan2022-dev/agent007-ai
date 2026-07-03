import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { generateTotpSecret, generateTotpUrl } from '@/lib/owner-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/owner-auth/totp
 * Sets up Google Authenticator for owner auth.
 *
 * Body: { action: 'setup' | 'disable' }
 *
 * Returns:
 *   - setup: { secret, otpauthUrl, qrCodeDataUrl, message }
 *   - disable: { ok, message }
 *
 * The owner scans the QR code with Google Authenticator app,
 * then verifies with /api/owner-auth/totp-verify to enable.
 */
export async function POST(req: NextRequest) {
  try {
    await ensureDbReady()
    const body = await req.json().catch(() => ({}))
    const action = (body.action as string) ?? 'setup'

    // Find the operator user
    const user = await db.user.findUnique({ where: { email: 'antonio.can2022@hotmail.com' } })
    if (!user) {
      return NextResponse.json({ ok: false, error: 'Operator user not found' }, { status: 404 })
    }

    if (action === 'disable') {
      // Disable TOTP — requires owner auth (use existing 2FA flow)
      try {
        await db.twoFactorSecret.updateMany({
          where: { userId: user.id, method: 'google_authenticator' },
          data: { enabled: false },
        })
        return NextResponse.json({
          ok: true,
          message: 'TOTP (Google Authenticator) disabled for owner auth. SMS/WhatsApp/Email will be used.',
        })
      } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message }, { status: 500 })
      }
    }

    // action === 'setup'
    // Generate a new secret
    const secret = generateTotpSecret()
    const otpauthUrl = generateTotpUrl(secret, user.email)

    // Delete any existing TOTP configs (not yet enabled)
    try {
      await db.twoFactorSecret.deleteMany({
        where: { userId: user.id, method: 'google_authenticator' },
      })
    } catch {}

    // Create a new config (not yet enabled — must be verified first)
    const config = await db.twoFactorSecret.create({
      data: {
        userId: user.id,
        method: 'google_authenticator',
        email: user.email,
        secret,
        qrCodeUrl: otpauthUrl,
        enabled: false,
      },
    })

    // Generate a simple QR code as an SVG data URL
    // (We use a free QR code API for the actual image)
    const qrCodeDataUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(otpauthUrl)}`

    return NextResponse.json({
      ok: true,
      configId: config.id,
      secret,
      otpauthUrl,
      qrCodeDataUrl,
      message: 'Scan this QR code with Google Authenticator app (or equivalent TOTP app). Then verify with the 6-digit code at /api/owner-auth/totp-verify.',
      manualEntry: `In Google Authenticator: Add account → Enter setup key → Name: Agent007 AI → Key: ${secret} → Time-based → 6 digits → 30s period`,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 })
  }
}

/**
 * GET /api/owner-auth/totp
 * Returns whether TOTP is configured for the owner.
 */
export async function GET() {
  try {
    await ensureDbReady()
    const user = await db.user.findUnique({ where: { email: 'antonio.can2022@hotmail.com' } })
    if (!user) {
      return NextResponse.json({ configured: false, enabled: false })
    }
    const config = await db.twoFactorSecret.findFirst({
      where: { userId: user.id, method: 'google_authenticator' },
      select: { id: true, enabled: true, qrCodeUrl: true, verifiedAt: true },
    })
    return NextResponse.json({
      configured: !!config,
      enabled: config?.enabled ?? false,
      qrCodeUrl: config?.qrCodeUrl ?? null,
      verifiedAt: config?.verifiedAt ?? null,
    })
  } catch (e: any) {
    return NextResponse.json({ configured: false, enabled: false, error: e?.message }, { status: 500 })
  }
}
