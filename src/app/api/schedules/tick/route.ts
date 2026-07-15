import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { isInteractiveActive } from '@/lib/load-tracker'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/schedules/tick
 * Called by: (1) dashboard polling every 60s, (2) Vercel Cron daily at 9AM
 * Checks for due schedules and kicks them off.
 *
 * UPGRADE #83: Also triggers QA + External monitors on every tick.
 * Since Vercel Hobby only allows daily crons, the dashboard's 60-second
 * polling loop acts as the "cron" — every time the dashboard polls
 * /api/schedules/tick, we also fire the monitors.
 *
 * This gives us ~60-second monitor frequency while the dashboard is open,
 * and daily frequency when the dashboard is closed (via Vercel Cron).
 */
export async function POST(req: NextRequest) {
  await ensureDbReady().catch(() => {})
  try {
    const url = new URL(req.url)
    const manualId = url.searchParams.get('id')

    // Find operator user
    const user = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
    if (!user) return NextResponse.json({ ok: true, dispatched: 0, message: 'no user' })

    // Manual trigger (Run Now button)
    if (manualId) {
      const sched = await db.schedule.findUnique({ where: { id: manualId } })
      if (!sched) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
      if (!sched.enabled) return NextResponse.json({ ok: false, error: 'Disabled' }, { status: 400 })
      await db.schedule.update({ where: { id: manualId }, data: { lastRunAt: new Date(), nextRunAt: new Date(Date.now() + sched.intervalMin * 60 * 1000) } })
      return NextResponse.json({ ok: true, dispatched: [sched.id], manual: true, message: sched.prompt.slice(0, 100) })
    }

    // Auto-trigger: check for due schedules
    if (isInteractiveActive()) {
      return NextResponse.json({ ok: true, dispatched: 0, skipped: 'interactive active', nextCheck: 60 })
    }

    const now = new Date()
    const due = await db.schedule.findMany({
      where: {
        userId: user.id,
        enabled: true,
        OR: [
          { nextRunAt: { lte: now } },
          { nextRunAt: null },
        ],
      },
      take: 5,
    })

    const dispatched: string[] = []
    for (const sched of due) {
      try {
        await db.schedule.update({
          where: { id: sched.id },
          data: { lastRunAt: now, nextRunAt: new Date(now.getTime() + sched.intervalMin * 60 * 1000) },
        })
        dispatched.push(sched.id)
      } catch {}
    }

    // UPGRADE #83: Fire monitors on every tick (dashboard polls every 60s)
    // This gives us ~60-second monitor frequency while dashboard is open.
    // Fire monitors in the background (don't block the response)
    const baseUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, '') ?? 'https://agent007-ai.vercel.app'
    fetch(`${baseUrl}/api/monitor/external`, { signal: AbortSignal.timeout(30000) }).catch(() => {})
    // Only fire QA monitor every 5th tick (~5 minutes) to avoid spamming
    const tickCount = (globalThis as any).__tickCount ?? 0
    ;(globalThis as any).__tickCount = tickCount + 1
    if (tickCount % 5 === 0) {
      fetch(`${baseUrl}/api/monitor/qa`, { signal: AbortSignal.timeout(30000) }).catch(() => {})
    }

    return NextResponse.json({ ok: true, dispatched, count: dispatched.length, nextCheck: 60, monitors: 'external fired, qa ' + (tickCount % 5 === 0 ? 'fired' : 'skipped (next in ' + (5 - (tickCount % 5)) + ' ticks)') })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}

/** GET handler for Vercel Cron (calls POST internally) */
export async function GET() {
  const req = new NextRequest('http://localhost:3000/api/schedules/tick', { method: 'POST' })
  return POST(req)
}
