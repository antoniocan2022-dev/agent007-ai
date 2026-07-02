import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUserId } from '@/lib/session-user'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const userId = await getSessionUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await req.json()
    const { configId } = body
    if (!configId) return NextResponse.json({ error: 'configId required' }, { status: 400 })
    await db.twoFactorSecret.update({ where: { id: configId }, data: { enabled: false, verifiedAt: null } })
    try { await db.auditLog.create({ data: { userId, action: '2fa_disable', entity: 'two_factor', entityId: configId, description: '2FA disabled' } }) } catch {}
    return NextResponse.json({ ok: true, message: '2FA disabled' })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
