import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { isInteractiveActive } from '@/lib/load-tracker'
import { runOrchestrator } from '@/lib/orchestrator'
import { backgroundFire } from '@/lib/runtime/background-tasks'
import { notifyMissionOutcome } from '@/lib/mission-notifications'

// Phase 3 of the CEO Conversation Kernel migration (making the orchestrator execution-only,
// 2026-09-19): runOrchestrator no longer persists its own `finalAnswer` as the assistant's final
// Message row or fires the mission-complete/failed notification itself (see that file's own header
// comment) -- every caller now owns both. Unlike route.ts's interactive path, this scheduled path has
// no quality-gated synthesis step of its own (no composeCeoContext, no pre-routing, no
// runCeoCognitiveLifecycle pass) -- persistOrchestratorResult below preserves exactly the fidelity
// scheduled missions already had (the orchestrator's own transcript text, unchanged) rather than
// silently losing scheduled-mission history now that the orchestrator itself won't record it. Giving
// scheduled missions the same governance interactive requests get is real, valuable future work --
// deliberately not attempted here, since it means building a parallel context/pre-routing pipeline for
// a codepath that currently has none, not just relocating a persistence call.
async function persistOrchestratorResult(conversationId: string, result: Awaited<ReturnType<typeof runOrchestrator>>): Promise<void> {
  try {
    await db.message.create({ data: { conversationId, role: 'assistant', content: result.finalAnswer } })
  } catch (dbErr: any) {
    console.warn('[schedules/tick] DB write failed (assistant message), continuing without persistence:', dbErr?.message?.slice(0, 100))
  }
  await notifyMissionOutcome({ conversationId, content: result.finalAnswer, steps: result.steps }).catch(() => {})
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Scheduled mission dispatcher.
 *
 * Scheduling logic is hosting-neutral. On Vercel Hobby this endpoint is the
 * single daily cron entry point. It dispatches enabled internal schedules and
 * the daily governance/CEO/reconciliation jobs without requiring multiple
 * Vercel Cron definitions.
 *
 * The Mission Autonomy Supervisor is also fired from this single scheduler so
 * persistent missions can be inspected, resumed, blocked, or advanced without
 * requiring the owner to remain online.
 */
export async function POST(req: NextRequest) {
  await ensureDbReady().catch(() => {})

  try {
    const url = new URL(req.url)
    const manualId = url.searchParams.get('id')
    const user = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
    if (!user) return NextResponse.json({ ok: true, dispatched: 0, message: 'no user' })

    if (manualId) {
      const sched = await db.schedule.findUnique({ where: { id: manualId } })
      if (!sched) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
      if (!sched.enabled) return NextResponse.json({ ok: false, error: 'Disabled' }, { status: 400 })

      await db.schedule.update({
        where: { id: manualId },
        data: { lastRunAt: new Date(), nextRunAt: new Date(Date.now() + sched.intervalMin * 60 * 1000) },
      })

      try {
        let convId = sched.lastConvId
        if (!convId) {
          const conv = await db.conversation.create({ data: { title: `Scheduled: ${sched.name}` } })
          convId = conv.id
          await db.schedule.update({ where: { id: sched.id }, data: { lastConvId: convId } })
        }

        const result = await runOrchestrator({
          conversationId: convId,
          userMessage: sched.prompt,
          attachments: [],
          language: 'en',
          emit: async () => {},
        })
        await persistOrchestratorResult(convId, result)
      } catch (error: any) {
        console.error('[schedules/tick] Manual execution failed:', error?.message?.slice(0, 150))
      }

      return NextResponse.json({ ok: true, dispatched: [sched.id], manual: true, executed: true, message: sched.prompt.slice(0, 100) })
    }

    if (isInteractiveActive()) {
      return NextResponse.json({ ok: true, dispatched: 0, skipped: 'interactive active', nextCheck: 1440 })
    }

    const now = new Date()
    const due = await db.schedule.findMany({
      where: {
        userId: user.id,
        enabled: true,
        OR: [{ nextRunAt: { lte: now } }, { nextRunAt: null }],
      },
      take: 3,
    })

    const dispatched: string[] = []
    const executed: string[] = []

    for (const sched of due) {
      try {
        await db.schedule.update({
          where: { id: sched.id },
          data: { lastRunAt: now, nextRunAt: new Date(now.getTime() + sched.intervalMin * 60 * 1000) },
        })
        dispatched.push(sched.id)

        backgroundFire((async () => {
          try {
            let convId = sched.lastConvId
            if (!convId) {
              const conv = await db.conversation.create({ data: { title: `Scheduled: ${sched.name}` } })
              convId = conv.id
              await db.schedule.update({ where: { id: sched.id }, data: { lastConvId: convId } })
            }

            const result = await runOrchestrator({
              conversationId: convId,
              userMessage: sched.prompt,
              attachments: [],
              language: 'en',
              emit: async () => {},
            })
            await persistOrchestratorResult(convId, result)
            console.log(`[schedules/tick] Background exec ${sched.id}: ${result.finalAnswer?.slice(0, 100) ?? 'no answer'}`)
          } catch (error: any) {
            console.error(`[schedules/tick] Background exec failed ${sched.id}:`, error?.message?.slice(0, 150))
          }
        })())
        executed.push(sched.id)
      } catch (error: any) {
        console.error(`[schedules/tick] Dispatch failed ${sched.id}:`, error?.message?.slice(0, 150))
      }
    }

    const baseUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, '') || url.origin
    const cronSecret = process.env.CRON_SECRET?.trim()
    const fireDaily = (path: string) => {
      if (!cronSecret) {
        console.warn(`[schedules/tick] CRON_SECRET missing; skipped protected daily job ${path}`)
        return
      }
      backgroundFire(fetch(`${baseUrl}${path}`, {
        headers: { authorization: `Bearer ${cronSecret}` },
        signal: AbortSignal.timeout(30000),
      }).catch((error) => console.error(`[schedules/tick] Daily job failed ${path}:`, error?.message?.slice(0, 150))))
    }

    // Single Hobby-compatible daily entry point for all protected periodic work.
    fireDaily('/api/monitor/external')
    fireDaily('/api/monitor/qa')
    fireDaily('/api/schedules/ceo-morning-brief')
    fireDaily('/api/schedules/ceo-operations-report')
    fireDaily('/api/schedules/investor-intelligence-brief')
    fireDaily('/api/revenue-reconciliation')
    fireDaily('/api/system/mission-supervisor')
    fireDaily('/api/schedules/evidence-watch-check')

    const tickCount = (globalThis as { __tickCount?: number }).__tickCount ?? 0
    ;(globalThis as { __tickCount?: number }).__tickCount = tickCount + 1

    return NextResponse.json({
      ok: true,
      dispatched,
      executed,
      count: dispatched.length,
      executedCount: executed.length,
      nextCheck: 1440,
      monitors: 'daily external/qa, CEO briefs, investor brief, revenue reconciliation, mission autonomy supervisor, and evidence-watch checks fired',
    })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return POST(req)
}
