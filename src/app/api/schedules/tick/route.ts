import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getOperatorUserId } from '@/lib/settings'
import { isInteractiveActive } from '@/lib/load-tracker'
import { kickOffScheduleRun } from '../route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/schedules/tick
 *
 * Polling endpoint called by the dashboard every 60s. Checks for enabled
 * schedules whose nextRunAt <= now (or null but enabled+overdue), and kicks
 * them off in the background. Also accepts a `?id=...` query param to manually
 * trigger a specific schedule immediately ("Run Now" button).
 *
 * Priority rule (#12): if any interactive /api/agent request is currently
 * active, scheduled dispatches are deferred to the next tick so user-initiated
 * chats always get priority over scheduled runs.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await getOperatorUserId()
    if (!userId) return NextResponse.json({ ok: true, dispatched: 0, message: 'no operator user' })

    const url = new URL(req.url)
    const manualId = url.searchParams.get('id')

    if (manualId) {
      const sched = await db.schedule.findUnique({ where: { id: manualId } })
      if (!sched || sched.userId !== userId) {
        return NextResponse.json({ ok: false, error: 'Schedule not found' }, { status: 404 })
      }
      if (!sched.enabled) {
        return NextResponse.json({ ok: false, error: 'Schedule is disabled — enable it first' }, { status: 400 })
      }
      kickOffScheduleRun(sched.id, sched.prompt, userId).catch((e) =>
        console.error('[schedules/tick] manual run failed:', e)
      )
      return NextResponse.json({ ok: true, dispatched: [sched.id], manual: true })
    }

    // Priority rule: if an interactive request is active, defer scheduled runs.
    if (isInteractiveActive()) {
      return NextResponse.json({
        ok: true,
        dispatched: 0,
        skipped: 'interactive active',
        nextCheck: 60,
      })
    }

    const now = new Date()
    const due = await db.schedule.findMany({
      where: {
        userId,
        enabled: true,
        OR: [
          { nextRunAt: { lte: now } },
          {
            nextRunAt: null,
            lastRunAt: { lte: new Date(now.getTime() - 60 * 1000) },
          },
        ],
      },
      take: 3, // max 3 per tick to avoid runaway
    })

    const dispatched: string[] = []
    for (const s of due) {
      kickOffScheduleRun(s.id, s.prompt, userId).catch((e) =>
        console.error(`[schedules/tick] failed to dispatch ${s.id}:`, e)
      )
      dispatched.push(s.id)
    }

    return NextResponse.json({ ok: true, dispatched, count: dispatched.length, now: now.toISOString() })
  } catch (e: any) {
    console.error('[schedules/tick]', e)
    return NextResponse.json({ ok: false, error: e?.message ?? 'tick failed' }, { status: 500 })
  }
}
