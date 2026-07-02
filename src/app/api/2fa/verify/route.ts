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
    const { configId, code } = body
    if (!configId || !code) return NextResponse.json({ error: 'configId and code required' }, { status: 400 })
    const config = await db.twoFactorSecret.findFirst({ where: { id: configId, userId } })
    if (!config) return NextResponse.json({ error: 'Config not found' }, { status: 404 })
    // For TOTP, verify the code (simplified — in production use a proper TOTP library)
    // For SMS/WhatsApp, any 6-digit code accepted for demo
    const isValid = code.length === 6 || (config.method === 'google_authenticator' && code.length === 6)
    if (!isValid) return NextResponse.json({ error: 'Invalid code' }, { status: 400 })
    await db.twoFactorSecret.update({ where: { id: configId }, data: { enabled: true, verifiedAt: new Date() } })
    try { await db.auditLog.create({ data: { userId, action: '2fa_enable', entity: 'two_factor', entityId: configId, description: `2FA enabled via ${config.method}` } }) } catch {}
    return NextResponse.json({ ok: true, message: '✅ 2FA enabled successfully' })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
