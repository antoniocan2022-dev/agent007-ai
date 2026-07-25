import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { isInteractiveActive } from '@/lib/load-tracker'
import { runOrchestrator } from '@/lib/orchestrator'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * POST /api/schedules/tick — UPGRADE #136
 * Called by: (1) dashboard polling every 60s, (2) Vercel Cron daily at 9AM
 *
 * UPGRADE #136: Now ACTUALLY EXECUTES scheduled prompts.
 * Before: found due schedules, updated timestamps, returned "dispatched" —
 *   but never ran the prompt. The schedule was a reminder that nobody acted on.
 * After: finds due schedules, updates timestamps, AND calls runOrchestrator()
 *   with the schedule's prompt. The agent actually does the work.
 */
export async function POST(req: NextRequest) {
  await ensureDbReady().catch(() => {})
  try {
    const url = new URL(req.url)
    const manualId = url.searchParams.get('id')

    // Find operator user
    const user = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
    if (!user) return NextResponse.json({ ok: true, dispatched: 0, message: 'no user' })

    // Manual trigger (Run Now button) — also executes now
    if (manualId) {
      const sched = await db.schedule.findUnique({ where: { id: manualId } })
      if (!sched) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
      if (!sched.enabled) return NextResponse.json({ ok: false, error: 'Disabled' }, { status: 400 })
      await db.schedule.update({ where: { id: manualId }, data: { lastRunAt: new Date(), nextRunAt: new Date(Date.now() + sched.intervalMin * 60 * 1000) } })

      // UPGRADE #136: Actually execute the prompt
      try {
        // Create or find a conversation for this schedule
        let convId = sched.lastConvId
        if (!convId) {
          const conv = await db.conversation.create({ data: { title: `Scheduled: ${sched.name}` } })
          convId = conv.id
          await db.schedule.update({ where: { id: sched.id }, data: { lastConvId: convId } })
        }

        // Run the orchestrator with the schedule's prompt (silent — no SSE)
        await runOrchestrator({
          conversationId: convId,
          userMessage: sched.prompt,
          attachments: [],
          language: 'en',
          emit: async () => {},  // silent — no UI stream for scheduled tasks
        })
      } catch (e: any) {
        console.error('[schedules/tick] Manual execution failed:', e?.message?.slice(0, 150))
      }

      return NextResponse.json({ ok: true, dispatched: [sched.id], manual: true, executed: true, message: sched.prompt.slice(0, 100) })
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
      take: 3,  // UPGRADE #136: reduced from 5 to 3 to avoid timeout (each takes ~30-60s)
    })

    const dispatched: string[] = []
    const executed: string[] = []

    for (const sched of due) {
      try {
        // Update timestamps
        await db.schedule.update({
          where: { id: sched.id },
          data: { lastRunAt: now, nextRunAt: new Date(now.getTime() + sched.intervalMin * 60 * 1000) },
        })
        dispatched.push(sched.id)

        // UPGRADE #136: ACTUALLY EXECUTE the scheduled prompt
        try {
          // Create or find a conversation for this schedule
          let convId = sched.lastConvId
          if (!convId) {
            const conv = await db.conversation.create({ data: { title: `Scheduled: ${sched.name}` } })
            convId = conv.id
            await db.schedule.update({ where: { id: sched.id }, data: { lastConvId: convId } })
          }

          // Run the orchestrator with the schedule's prompt (silent — no SSE)
          const result = await runOrchestrator({
            conversationId: convId,
            userMessage: sched.prompt,
            attachments: [],
            language: 'en',
            emit: async () => {},  // silent — no UI stream for scheduled tasks
          })
          executed.push(sched.id)
          console.log(`[schedules/tick] Executed schedule ${sched.id}: ${result.finalAnswer?.slice(0, 100) ?? 'no answer'}`)
        } catch (execErr: any) {
          console.error(`[schedules/tick] Execution failed for ${sched.id}:`, execErr?.message?.slice(0, 150))
        }
      } catch {}
    }

    // UPGRADE #83: Fire monitors on every tick
    const baseUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, '') ?? 'https://agent007-ai.vercel.app'
    fetch(`${baseUrl}/api/monitor/external`, { signal: AbortSignal.timeout(30000) }).catch(() => {})
    const tickCount = (globalThis as any).__tickCount ?? 0
    ;(globalThis as any).__tickCount = tickCount + 1
    if (tickCount % 5 === 0) {
      fetch(`${baseUrl}/api/monitor/qa`, { signal: AbortSignal.timeout(30000) }).catch(() => {})
    }

    return NextResponse.json({
      ok: true,
      dispatched,
      executed,  // UPGRADE #136: new field — which schedules were actually run
      count: dispatched.length,
      executedCount: executed.length,
      nextCheck: 60,
      monitors: 'external fired, qa ' + (tickCount % 5 === 0 ? 'fired' : 'skipped'),
    })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}

/** GET handler for Vercel Cron (calls POST internally) */
export async function GET() {
  const req = new NextRequest('http://localhost:3000/api/schedules/tick', { method: 'POST' })
  return POST(req)
}
