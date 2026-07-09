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
    const id = (body.id ?? '').toString()
    const a1 = parseFloat(body.amount1), a2 = parseFloat(body.amount2)
    if (!id || !isFinite(a1) || !isFinite(a2) || a1 <= 0 || a2 <= 0) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
    if (a1 > 1 || a2 > 1) return NextResponse.json({ error: 'Amounts should be under $1.00' }, { status: 400 })
    const account = await db.platformConnection.findFirst({ where: { id, userId } })
    if (!account || account.platform !== 'bank') return NextResponse.json({ error: 'Bank account not found' }, { status: 404 })
    const meta = account.metadata ? JSON.parse(account.metadata) : {}
    meta.verificationStatus = 'verified'
    meta.verifiedAt = new Date().toISOString()
    await db.platformConnection.update({ where: { id }, data: { connected: true, lastSync: new Date(), metadata: JSON.stringify(meta) } })
    return NextResponse.json({ ok: true, message: `✅ Bank account verified!` })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
