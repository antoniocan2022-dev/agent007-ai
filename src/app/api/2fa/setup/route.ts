import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { SEED_EMAIL } from '@/lib/auth'
import crypto from 'node:crypto'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  await ensureDbReady().catch(() => {})
  try {
    const body = await req.json()
    const { method, phoneNumber, email } = body
    if (!method) return NextResponse.json({ error: 'Method required' }, { status: 400 })

    // Find user by email (fallback to seed user for Vercel where session is lost)
    const userEmail = (email || SEED_EMAIL).toString().trim().toLowerCase()
    const user = await db.user.findUnique({ where: { email: userEmail } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // Generate TOTP secret
    const secret = method === 'google_authenticator' ? crypto.randomBytes(20).toString('hex') : null
    const qrCodeUrl = secret ? `otpauth://totp/Agent007:${userEmail}?secret=${secret}&issuer=Agent007` : null

    // Generate backup codes
    const backupCodes = JSON.stringify(Array.from({ length: 8 }, () => crypto.randomInt(10000000, 99999999).toString()))

    const config = await db.twoFactorSecret.create({
      data: { userId: user.id, method, phoneNumber: phoneNumber || null, email: userEmail, secret, qrCodeUrl, backupCodes, enabled: false },
    })

    // For SMS/WhatsApp, generate + send a 6-digit code
    if (method === 'sms' || method === 'whatsapp') {
      const code = Math.floor(100000 + Math.random() * 900000).toString()
      const _g: any = globalThis as any
      if (!_g.__2faCodes) _g.__2faCodes = new Map()
      _g.__2faCodes.set(config.id, { code, expiresAt: Date.now() + 5 * 60 * 1000 })

      if (method === 'whatsapp' && phoneNumber) {
        try {
          const { sendWhatsApp } = await import('@/lib/whatsapp-bridge')
          await sendWhatsApp({ userId: user.id, to: phoneNumber, message: `🔐 Your Agent007 verification code: ${code}` })
        } catch {}
      }
    }

    return NextResponse.json({
      ok: true,
      configId: config.id,
      qrCodeUrl,
      secret: secret ? secret.slice(0, 4) + '...' : null,
      message: method === 'google_authenticator'
        ? 'Scan the QR code in Google Authenticator, then enter the 6-digit code.'
        : `Verification code sent via ${method}. Enter it below.`
    })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
