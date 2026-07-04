import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email } = body
    if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })
    const user = await db.user.findUnique({ where: { email: email.toString().trim().toLowerCase() } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    const config = await db.twoFactorSecret.findFirst({ where: { userId: user.id, enabled: true } })
    if (!config) return NextResponse.json({ ok: true, requiresTwoFactor: false, message: 'No 2FA enabled' })

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
      await sendWhatsApp({ userId: user.id, to: config.phoneNumber || '', message: `Your Agent007 verification code: ${code}` }).catch(() => {})
    } else if (config.method === 'email') {
      const { sendEmail } = await import('@/lib/email')
      await sendEmail({ to: config.email || email, subject: 'Agent007 Verification Code', body: `Your verification code is: ${code}`, userId: user.id, type: '2fa' }).catch(() => {})
    }
    return NextResponse.json({ ok: true, requiresTwoFactor: true, userId: user.id, method: config.method, message: `Code sent via ${config.method}` })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
