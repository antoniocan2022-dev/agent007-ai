import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUserId } from '@/lib/session-user'
import crypto from 'node:crypto'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const userId = await getSessionUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await req.json()
    const { method, phoneNumber, email } = body
    if (!method) return NextResponse.json({ error: 'Method required' }, { status: 400 })

    // Generate TOTP secret for google_authenticator
    const secret = method === 'google_authenticator' ? crypto.randomBytes(20).toString('hex') : null
    const qrCodeUrl = secret ? `otpauth://totp/Agent007:${email || 'operator'}?secret=${secret}&issuer=Agent007` : null

    // Generate backup codes
    const backupCodes = JSON.stringify(Array.from({ length: 8 }, () => crypto.randomInt(10000000, 99999999).toString()))

    const config = await db.twoFactorSecret.create({
      data: { userId, method, phoneNumber: phoneNumber || null, email: email || null, secret, qrCodeUrl, backupCodes, enabled: false },
    })
    return NextResponse.json({ ok: true, configId: config.id, qrCodeUrl, secret: secret ? secret.slice(0, 4) + '...' : null, message: '2FA setup initiated. Verify with a code to enable.' })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
