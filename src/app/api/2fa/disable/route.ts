import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  await ensureDbReady()
  try {
    const body = await req.json()
    const configId = (body.configId || '').toString()
    if (!configId) return NextResponse.json({ error: 'configId required' }, { status: 400 })
    await db.twoFactorSecret.update({ where: { id: configId }, data: { enabled: false, verifiedAt: null } }).catch(() => {})
    return NextResponse.json({ ok: true, message: '2FA disabled' })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
