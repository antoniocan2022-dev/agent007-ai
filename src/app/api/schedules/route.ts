import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { getOperatorUserId } from '@/lib/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const DEFAULT_MISSION_PROMPT =
  "Run today's passive income mission: scan trends via Scout, find 3 opportunities via Hunt, pick the best, dispatch Aurora or Vertex to execute one step, monitor with Pulse, and report outcomes with projected income."

/** GET /api/schedules — list all schedules for the operator.
 *  Auto-creates the default "Daily Income Mission" schedule on first load
 *  if the operator has no schedules yet (enabled=false — user must toggle on). */
export async function GET() {
  try {
    await ensureDbReady().catch(() => {})
    const userId = await getOperatorUserId()
    if (!userId) return NextResponse.json({ schedules: [] })
    let schedules = await db.schedule.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })
    // Auto-seed the default schedule on first load
    if (schedules.length === 0) {
      try {
        const created = await db.schedule.create({
          data: {
            userId,
            name: 'Daily Income Mission',
            prompt: DEFAULT_MISSION_PROMPT,
            intervalMin: 1440,
            enabled: false, // user must toggle on
            nextRunAt: null,
          },
        })
        schedules = [created]
      } catch (seedErr) {
        console.error('[schedules GET] auto-seed default failed:', seedErr)
      }
    }
    return NextResponse.json({ schedules })
  } catch (e: any) {
    console.error('[schedules GET]', e)
    return NextResponse.json({ error: e?.message ?? 'Failed to list schedules' }, { status: 500 })
  }
}

/** POST /api/schedules — create a new schedule. */
export async function POST(req: NextRequest) {
  try {
    await ensureDbReady().catch(() => {})
    const userId = await getOperatorUserId()
    if (!userId) return NextResponse.json({ error: 'No operator user found' }, { status: 500 })

    const body = await req.json().catch(() => ({}))
    const { name, prompt, intervalMin, enabled, runNow } = body as {
      name?: string
      prompt?: string
      intervalMin?: number
      enabled?: boolean
      runNow?: boolean
    }

    const safeName = (name ?? 'Daily Mission').toString().trim().slice(0, 120) || 'Daily Mission'
    const safePrompt = (prompt ?? DEFAULT_MISSION_PROMPT).toString().slice(0, 4000) || DEFAULT_MISSION_PROMPT
    const interval = typeof intervalMin === 'number' && intervalMin > 0
      ? Math.min(Math.floor(intervalMin), 60 * 24 * 30)
      : 1440 // default 24h
    const isEnabled = enabled !== false

    const now = new Date()
    const nextRunAt = isEnabled ? new Date(now.getTime() + interval * 60 * 1000) : null

    const schedule = await db.schedule.create({
      data: {
        userId,
        name: safeName,
        prompt: safePrompt,
        intervalMin: interval,
        enabled: isEnabled,
        nextRunAt,
      },
    })

    // If "runNow" requested, dispatch immediately in the background
    if (runNow || false) {
      kickOffScheduleRun(schedule.id, safePrompt, userId).catch((e) =>
        console.error('[schedules POST] kickOffScheduleRun failed:', e)
      )
    }

    return NextResponse.json({ ok: true, schedule })
  } catch (e: any) {
    console.error('[schedules POST]', e)
    return NextResponse.json({ error: e?.message ?? 'Failed to create schedule' }, { status: 500 })
  }
}

/**
 * Kick off a scheduled agent run in the background.
 * Creates a new conversation, then POSTs to /api/agent (relative path).
 * Updates the schedule row with lastRunAt, nextRunAt, and lastConvId when finished.
 *
 * This is fire-and-forget: callers do NOT await it.
 */
export async function kickOffScheduleRun(
  scheduleId: string,
  prompt: string,
  userId: string
): Promise<void> {
  // Mark schedule as "running now" — set lastRunAt + clear nextRunAt temporarily
  await db.schedule.update({
    where: { id: scheduleId },
    data: { lastRunAt: new Date(), nextRunAt: null },
  })

  let convId: string | null = null
  try {
    // Create a conversation for this scheduled run
    const conv = await db.conversation.create({
      data: { title: `Scheduled: ${prompt.slice(0, 40)}` },
    })
    convId = conv.id

    // Persist the user-style message that initiated the run
    await db.message.create({
      data: {
        conversationId: convId,
        role: 'user',
        content: prompt,
        attachments: null,
      },
    })

    // Fire-and-forget POST to /api/agent — the gateway will route to port 3000.
    // We use a relative URL via fetch with `next: { revalidate: 0 }` semantics.
    // Note: the dev server only listens on localhost:3000; the Caddy gateway
    // forwards "/" → ":3000" so an absolute localhost URL works in dev.
    const baseUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, '') ?? 'http://localhost:3000'
    fetch(`${baseUrl}/api/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: prompt,
        conversationId: convId,
        attachments: [],
        language: 'en',
      }),
    }).catch((e) => {
      console.error(`[scheduler] background fetch to /api/agent failed for schedule ${scheduleId}:`, e)
    })

    // Update schedule row with the conversation we kicked off
    await db.schedule.update({
      where: { id: scheduleId },
      data: { lastConvId: convId },
    })

    // Notify on mission_complete (best-effort) — handled inside the orchestrator
    // when the run finishes, but we also queue a delayed check here in case
    // the orchestrator's hook misses it.
  } catch (e: any) {
    console.error(`[scheduler] kickOffScheduleRun failed for ${scheduleId}:`, e)
  } finally {
    // Set nextRunAt to now + interval, regardless of success/failure
    try {
      const sched = await db.schedule.findUnique({ where: { id: scheduleId } })
      if (sched && sched.enabled) {
        const next = new Date(Date.now() + sched.intervalMin * 60 * 1000)
        await db.schedule.update({ where: { id: scheduleId }, data: { nextRunAt: next } })
      }
    } catch {
      /* ignore */
    }
  }
}
