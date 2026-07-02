import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUserId } from '@/lib/session-user'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const userId = await getSessionUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const configs = await db.twoFactorSecret.findMany({ where: { userId }, select: { id: true, method: true, enabled: true, phoneNumber: true, email: true, verifiedAt: true } })
    return NextResponse.json({ configs, has2FA: configs.some(c => c.enabled) })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
