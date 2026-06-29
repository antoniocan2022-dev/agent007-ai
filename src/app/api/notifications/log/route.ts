import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getOperatorUserId } from '@/lib/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/notifications/log — list recent notification log entries. */
export async function GET(req: NextRequest) {
  try {
    const userId = await getOperatorUserId()
    if (!userId) return NextResponse.json({ logs: [] })
    const url = new URL(req.url)
    const limit = parseInt(url.searchParams.get('limit') ?? '50', 10)
    const logs = await db.notificationLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    })
    return NextResponse.json({ logs })
  } catch (e: any) {
    console.error('[notifications/log GET]', e)
    return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 })
  }
}
