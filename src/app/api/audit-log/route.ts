import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { getSessionUserId } from '@/lib/session-user'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    await ensureDbReady().catch(() => {})
    const userId = await getSessionUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const url = new URL(req.url)
    const limit = Math.min(500, parseInt(url.searchParams.get('limit') ?? '100'))
    const entries = await db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: limit })
    return NextResponse.json({ entries, count: entries.length })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
