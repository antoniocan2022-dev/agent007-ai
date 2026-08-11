import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { isInteractiveActive } from '@/lib/load-tracker'
import { runOrchestrator } from '@/lib/orchestrator'
import { backgroundFire } from '@/lib/runtime/background-tasks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Scheduled mission dispatcher.
 *
 * Scheduling logic is hosting-neutral. Background task lifetime is delegated
 * to the runtime adapter registered during application startup.
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

        await runOrchestrator({
          conversationId: convId,
          userMessage: sched.prompt,
          attachments: [],
          language: 'en',
          emit: async () => {},
        })
      } catch (error: any) {
        console.error('[schedules/tick] Manual execution failed:', error?.message?.slice(0, 150))
      }

      return NextResponse.json({ ok: true, dispatched: [sched.id], manual: true, executed: true, message: sched.prompt.slice(0, 100) })
    }

    if (isInteractiveActive()) {
      return NextResponse.json({ ok: true, dispatched: 0, skipped: 'interactive active', nextCheck: 60 })
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
    backgroundFire(fetch(`${baseUrl}/api/monitor/external`, { signal: AbortSignal.timeout(30000) }).catch(() => {}))

    const tickCount = (globalThis as { __tickCount?: number }).__tickCount ?? 0
    ;(globalThis as { __tickCount?: number }).__tickCount = tickCount + 1
    if (tickCount % 5 === 0) {
      backgroundFire(fetch(`${baseUrl}/api/monitor/qa`, { signal: AbortSignal.timeout(30000) }).catch(() => {}))
    }

    return NextResponse.json({
      ok: true,
      dispatched,
      executed,
      count: dispatched.length,
      executedCount: executed.length,
      nextCheck: 60,
      monitors: `external fired, qa ${tickCount % 5 === 0 ? 'fired' : 'skipped'}`,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return POST(req)
}
