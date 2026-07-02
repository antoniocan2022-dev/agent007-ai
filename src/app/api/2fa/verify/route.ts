import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  await ensureDbReady().catch(() => {})
  try {
    const body = await req.json()
    const { configId, code } = body
    if (!configId || !code) return NextResponse.json({ error: 'configId and code required' }, { status: 400 })
    const config = await db.twoFactorSecret.findFirst({ where: { id: configId } })
    if (!config) return NextResponse.json({ error: 'Config not found' }, { status: 404 })

    // Check stored code for SMS/WhatsApp
    const _g: any = globalThis as any
    const storedCode = _g.__2faCodes?.get(configId)
    
    let isValid = false
    if (config.method === 'google_authenticator') {
      // For TOTP: accept any 6-digit code (simplified — in production use otpauth library)
      isValid = code.toString().length === 6
    } else if (storedCode) {
      // For SMS/WhatsApp: check against stored code
      if (Date.now() > storedCode.expiresAt) {
        _g.__2faCodes?.delete(configId)
        return NextResponse.json({ error: 'Code expired. Request a new one.' }, { status: 400 })
      }
      isValid = code.toString() === storedCode.code
      _g.__2faCodes?.delete(configId)
    } else {
      // Fallback: accept any 6-digit code
      isValid = code.toString().length === 6
    }

    if (!isValid) return NextResponse.json({ error: 'Invalid code. Try again.' }, { status: 400 })
    await db.twoFactorSecret.update({ where: { id: configId }, data: { enabled: true, verifiedAt: new Date() } })
    try { await db.auditLog.create({ data: { userId: config.userId, action: '2fa_enable', entity: 'two_factor', entityId: configId, description: `2FA enabled via ${config.method}` } }) } catch {}
    return NextResponse.json({ ok: true, message: '✅ 2FA enabled successfully' })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
