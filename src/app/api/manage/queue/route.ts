import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getOperatorUserId } from '@/lib/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/manage/queue
 *
 * Returns the operator's pending manage actions (status = pending |
 * executing | done | failed). Used by the UI / future admin tooling
 * to surface what's queued or replaying.
 *
 * Query params:
 *   - status=pending|executing|done|failed  (default: pending,executing)
 *   - limit=20                               (default 20, max 100)
 */
export async function GET(req: Request) {
  try {
    const userId = await getOperatorUserId()
    if (!userId) {
      return NextResponse.json({ actions: [] })
    }

    const url = new URL(req.url)
    const statusParam = url.searchParams.get('status') ?? 'pending,executing'
    const statuses = statusParam
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get('limit') ?? '20') || 20, 1),
      100
    )

    const where: any = { userId }
    if (statuses.length > 0) {
      where.status = { in: statuses }
    }

    const actions = await db.pendingManageAction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    // Parse attrs JSON for client convenience
    const out = actions.map((a) => ({
      id: a.id,
      action: a.action,
      attrs: safeParse(a.attrs),
      status: a.status,
      result: a.result,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    }))

    return NextResponse.json({ actions: out })
  } catch (e: any) {
    console.error('[/api/manage/queue GET]', e)
    return NextResponse.json(
      { error: e?.message ?? 'Failed to load queue' },
      { status: 500 }
    )
  }
}

function safeParse(s: string): any {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}
