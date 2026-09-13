import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { isAuthorizedOwnerRequest } from '@/lib/owner-request-auth'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!(await isAuthorizedOwnerRequest(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureDbReady()
  try {
    const body = await req.json()
    const configId = (body.configId || '').toString()
    if (!configId) return NextResponse.json({ error: 'configId required' }, { status: 400 })
    const existing = await db.twoFactorSecret.findUnique({ where: { id: configId } })
    if (!existing) return NextResponse.json({ error: '2FA config not found' }, { status: 404 })
    await db.twoFactorSecret.update({ where: { id: configId }, data: { enabled: false, verifiedAt: null } })
    return NextResponse.json({ ok: true, message: '2FA disabled' })
  } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Failed to disable 2FA' }, { status: 500 }) }
}
