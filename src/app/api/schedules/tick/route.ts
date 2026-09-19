import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { isInteractiveActive } from '@/lib/load-tracker'
import { runOrchestrator } from '@/lib/orchestrator'
import { backgroundFire } from '@/lib/runtime/background-tasks'
import { notifyMissionOutcome } from '@/lib/mission-notifications'
import { preRouteCeoRequest } from '@/lib/ceo-pre-router'
import { buildCeoTurnDecision } from '@/lib/ceo-turn-decision'
import { tryOperationalDirectResponse } from '@/lib/ceo-operational-direct-response'

// Phase 3 of the CEO Conversation Kernel migration (making the orchestrator execution-only,
// 2026-09-19): runOrchestrator no longer persists its own `finalAnswer` as the assistant's final
// Message row or fires the mission-complete/failed notification itself (see that file's own header
// comment) -- every caller now owns both.
//
// Phase 3a+ (external re-audit, same day): the audit's strongest remaining ask was "scheduled
// convergence" -- route.ts's interactive path and this scheduled path should not have two different
// definitions of "final answer." A full convergence (composeCeoContext, real pre-routing with a
// canonical decision contract, the full runCeoCognitiveLifecycle fallback synthesis) would mean
// building a parallel context/pre-routing pipeline this codepath has never had -- genuinely bigger
// scope than this pass, deliberately still deferred. What IS bounded and safe: reusing the SAME
// quality gate route.ts's direct-response path already runs (tryOperationalDirectResponse), which
// needs only a cheap, deterministic preRouteCeoRequest classification and the turn's DecisionPlan --
// no DB-backed context composition at all. When the orchestrator's own transcript already passes that
// gate (the common case for a well-formed, honestly-reported execution), the governed content is
// persisted instead of the raw transcript. When it doesn't pass, behavior falls through to exactly
// what Phase 3a already shipped -- the raw transcript, unchanged -- never a regression, only ever an
// upgrade when the gate happens to pass. priorConversation is deliberately omitted (empty): scheduled
// missions are typically fresh, single-shot prompts, and thread continuity across ticks is exactly the
// kind of context-composition work being deferred, not silently half-built here.
async function persistOrchestratorResult(conversationId: string, objective: string, startedAt: number, result: Awaited<ReturnType<typeof runOrchestrator>>): Promise<void> {
  let finalContent = result.finalAnswer
  try {
    const messages = [{ role: 'user' as const, content: objective }]
    const preRoute = preRouteCeoRequest(messages)
    const turnDecision = buildCeoTurnDecision({ messages, preRoute })
    const direct = tryOperationalDirectResponse({
      messages,
      preRoute,
      decisionPlan: turnDecision.decisionPlan,
      objective,
      candidateContent: result.finalAnswer,
      responseMsBeforeCheck: Date.now() - startedAt,
      toolSteps: result.steps,
    })
    if (direct) finalContent = direct.content
  } catch (error: any) {
    console.warn('[schedules/tick] Governed direct-response attempt failed, persisting the raw transcript instead:', error?.message?.slice(0, 150))
  }
  try {
    await db.message.create({ data: { conversationId, role: 'assistant', content: finalContent } })
  } catch (dbErr: any) {
    console.warn('[schedules/tick] DB write failed (assistant message), continuing without persistence:', dbErr?.message?.slice(0, 100))
  }
  // classifyMissionOutcome (mission-notifications.ts) trusts result.steps -- the orchestrator's real
  // tool-execution outcomes -- regardless of which content (governed or raw) ended up persisted.
  await notifyMissionOutcome({ conversationId, content: finalContent, steps: result.steps }).catch(() => {})
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

        const manualStartedAt = Date.now()
        const result = await runOrchestrator({
          conversationId: convId,
          userMessage: sched.prompt,
          attachments: [],
          language: 'en',
          emit: async () => {},
        })
        await persistOrchestratorResult(convId, sched.prompt, manualStartedAt, result)
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

            const backgroundStartedAt = Date.now()
            const result = await runOrchestrator({
              conversationId: convId,
              userMessage: sched.prompt,
              attachments: [],
              language: 'en',
              emit: async () => {},
            })
            await persistOrchestratorResult(convId, sched.prompt, backgroundStartedAt, result)
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
