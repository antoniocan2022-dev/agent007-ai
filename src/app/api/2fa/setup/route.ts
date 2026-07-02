import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { SEED_EMAIL } from '@/lib/auth'
import crypto from 'node:crypto'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  await ensureDbReady()
  try {
    const body = await req.json()
    const method = (body.method || 'google_authenticator').toString()
    const phoneNumber = (body.phoneNumber || body.phone || '').toString().trim()
    const email = (body.email || SEED_EMAIL).toString().trim().toLowerCase()

    // Find user
    const user = await db.user.findUnique({ where: { email } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // Generate secret + backup codes
    const secret = method === 'google_authenticator' ? crypto.randomBytes(20).toString('hex') : null
    const qrCodeUrl = secret ? `otpauth://totp/Agent007:${email}?secret=${secret}&issuer=Agent007` : null
    const backupCodes = JSON.stringify(Array.from({ length: 8 }, () => crypto.randomInt(10000000, 99999999).toString()))

    // Create config
    const config = await db.twoFactorSecret.create({
      data: { userId: user.id, method, phoneNumber: phoneNumber || null, email, secret, qrCodeUrl, backupCodes, enabled: false },
    })

    // For SMS/WhatsApp/Email: generate + send 6-digit code
    let codeSent = false
    const code = Math.floor(100000 + Math.random() * 900000).toString()
    const _g2: any = globalThis as any
    if (!_g2.__2faCodes) _g2.__2faCodes = new Map()
    _g2.__2faCodes.set(config.id, { code, expiresAt: Date.now() + 5 * 60 * 1000 })

    if (method === 'whatsapp' && phoneNumber) {
      try {
        const { sendWhatsApp } = await import('@/lib/whatsapp-bridge')
        const result = await sendWhatsApp({ userId: user.id, to: phoneNumber, message: `🔐 Agent007 verification code: ${code}` })
        codeSent = result.ok
      } catch {}
    } else if (method === 'email') {
      try {
        const { sendEmail } = await import('@/lib/email')
        await sendEmail({ to: email, subject: '🔐 Agent007 Verification Code', body: `Your verification code is: ${code}\n\nThis code expires in 5 minutes.`, userId: user.id, type: '2fa' })
        codeSent = true
      } catch {}
    } else if (method === 'sms') {
      // SMS sending requires Twilio — just store the code
      codeSent = false
    }

    return NextResponse.json({
      ok: true,
      configId: config.id,
      qrCodeUrl,
      secret: secret ? secret.slice(0, 4) + '...' : null,
      codeSent,
      message: method === 'google_authenticator'
        ? 'Scan the QR URL in Google Authenticator app, then enter the 6-digit code below.'
        : codeSent
          ? `Verification code sent via ${method}. Check your ${method === 'email' ? 'email' : 'phone'}.`
          : `Code generated: ${code} (manual delivery — configure ${method} provider to auto-send)`,
    })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
