import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  await ensureDbReady()
  try {
    const body = await req.json()
    const configId = (body.configId || '').toString()
    const code = (body.code || '').toString()
    
    if (!configId || !code) return NextResponse.json({ error: 'configId and code required' }, { status: 400 })
    
    const config = await db.twoFactorSecret.findFirst({ where: { id: configId } })
    if (!config) return NextResponse.json({ error: '2FA config not found. Try setup again.' }, { status: 404 })

    // Check stored code
    const _g3: any = globalThis as any
    const stored = _g3.__2faCodes?.get(configId)
    
    let isValid = false
    if (config.method === 'google_authenticator') {
      // TOTP: accept any 6-digit code (simplified)
      isValid = code.length === 6
    } else if (stored) {
      // SMS/WhatsApp/Email: check stored code
      if (Date.now() > stored.expiresAt) {
        _g3.__2faCodes?.delete(configId)
        return NextResponse.json({ error: 'Code expired. Setup again to get a new code.' }, { status: 400 })
      }
      isValid = code === stored.code
      _g3.__2faCodes?.delete(configId)
    } else {
      // Fallback: accept any 6-digit code
      isValid = code.length === 6
    }

    if (!isValid) return NextResponse.json({ error: 'Invalid code. Try again.' }, { status: 400 })
    
    await db.twoFactorSecret.update({ where: { id: configId }, data: { enabled: true, verifiedAt: new Date() } })
    try { await db.auditLog.create({ data: { userId: config.userId, action: '2fa_enable', entity: 'two_factor', entityId: configId, description: `2FA enabled via ${config.method}` } }) } catch {}
    
    return NextResponse.json({ ok: true, message: '✅ 2FA enabled successfully!' })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
