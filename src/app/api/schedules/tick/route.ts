import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { isInteractiveActive } from '@/lib/load-tracker'
import { runOrchestrator } from '@/lib/orchestrator'
import { backgroundFire } from '@/lib/runtime/background-tasks'
import { notifyMissionOutcome } from '@/lib/mission-notifications'
import { preRouteCeoRequest } from '@/lib/ceo-pre-router'
import { buildCeoTurnDecision } from '@/lib/ceo-turn-decision'
import { composeCeoContext, buildCeoContextModules, type PersistedConversationRow } from '@/lib/ceo-context-composer'
import { safeConversationRows } from '@/lib/ceo-behavioral-policy'
import { interpretCeoSemantics } from '@/lib/ceo-semantic-interpreter'
import { runCeoCognitiveLifecycle } from '@/lib/ceo-cognitive-lifecycle'
import { buildCeoSystemPrompt } from '@/lib/ceo-system-prompt'
import { persistCeoAssistantMessage } from '@/lib/ceo-response-persistence'

// Phase 3b — scheduled requests now use the same ACT/RESPOND boundary as interactive requests.
// runOrchestrator returns execution evidence only; this module invokes the canonical CEO lifecycle,
// persists its governed final response, and notifies only after that final response is committed.

async function loadScheduledConversationRows(conversationId: string): Promise<PersistedConversationRow[]> {
  try {
    const conversation = await db.conversation.findUnique({
      where: { id: conversationId },
      select: {
        Message: {
          orderBy: { createdAt: 'asc' },
          select: { role: true, content: true, createdAt: true },
        },
      },
    })
    return safeConversationRows((conversation?.Message ?? []).map((row) => ({
      role: row.role,
      content: row.content,
      createdAt: row.createdAt,
    })))
  } catch {
    return []
  }
}

async function executeScheduledRun(conversationId: string, objective: string): Promise<Awaited<ReturnType<typeof runOrchestrator>>> {
  // The scheduler owns the user-turn record because the ACT engine no longer mutates conversation history.
  const capturedTurnSequence = await db.$transaction(async (tx) => {
    const updatedConversation = await tx.conversation.update({
      where: { id: conversationId },
      data: { revision: { increment: 1 } },
      select: { revision: true },
    })
    await tx.message.create({
      data: {
        conversationId,
        role: 'user',
        content: objective,
        turnSequence: updatedConversation.revision,
        turnStatus: 'closed',
      },
    })
    return updatedConversation.revision
  })

  const result = await runOrchestrator({
    conversationId,
    userMessage: objective,
    attachments: [],
    language: 'en',
    emit: async () => {},
  })

  const persistedRows = await loadScheduledConversationRows(conversationId)
  let contextSeed = await composeCeoContext({
    systemPrompt: buildCeoSystemPrompt(),
    currentUserMessage: objective,
    persistedMessages: persistedRows,
    memories: [],
  })
  let semanticInterpretation: Awaited<ReturnType<typeof interpretCeoSemantics>> = { source: 'deterministic' }
  try {
    semanticInterpretation = await interpretCeoSemantics(contextSeed.canonicalSemanticContext)
  } catch {}

  contextSeed = await composeCeoContext({
    systemPrompt: buildCeoSystemPrompt(),
    currentUserMessage: objective,
    persistedMessages: persistedRows,
    memories: [],
    semanticInterpretation,
    reuseSemanticContext: {
      selectedMemories: contextSeed.selectedMemories,
      semanticMemoryKeys: contextSeed.semanticMemoryKeys,
    },
  })

  const decisionContract = contextSeed.decisionContract
  const preRoute = preRouteCeoRequest(contextSeed.messages, 0, contextSeed.canonicalSemanticContext, decisionContract)
  const turnDecision = buildCeoTurnDecision({
    messages: contextSeed.messages,
    preRoute,
    taskType: preRoute.taskClass,
    decisionContract,
  })
  const operationalToolSteps = result.steps.filter((step) => Boolean(step.toolName))
  const anyOperationalToolStepFailed = operationalToolSteps.some((step) => step.toolResult && step.toolResult.ok === false)

  const finalModules = buildCeoContextModules({
    intent: preRoute.executionContract.intent,
    missionRelevant: preRoute.missionRelevant,
    evidenceClass: preRoute.executionContract.evidenceClass,
    taskClass: preRoute.taskClass,
    executionRequirement: preRoute.executionContract.executionRequirement,
    execution: result.executionSummary,
  })
  const composedFinalContext = await composeCeoContext({
    systemPrompt: buildCeoSystemPrompt(),
    currentUserMessage: objective,
    persistedMessages: persistedRows,
    memories: [],
    modules: finalModules,
    semanticInterpretation,
    reuseSemanticContext: {
      conversationState: contextSeed.conversationState,
      canonicalSemanticContext: contextSeed.canonicalSemanticContext,
      decisionContract: contextSeed.decisionContract,
      resolvedReferences: contextSeed.resolvedReferences,
      selectedMemories: contextSeed.selectedMemories,
      semanticMemoryKeys: contextSeed.semanticMemoryKeys,
    },
  })

  const synthesis = await runCeoCognitiveLifecycle({
    attachmentsCount: 0,
    messages: composedFinalContext.messages,
    taskType: preRoute.taskClass,
    timeoutMs: Math.min(120000, turnDecision.decisionPlan.latencyBudgetMs),
    contextualEvidence: result.executionSummary,
    evidenceScope: operationalToolSteps.length > 0 ? 'live_system' : 'internal_state',
    evidenceFreshness: { observedAt: Date.now(), maxAgeMs: 300000 },
    externalExecutionSucceeded: !anyOperationalToolStepFailed,
    priorConversation: persistedRows,
    relevantOlderConversation: persistedRows,
    preRoute,
    decisionPlan: turnDecision.decisionPlan,
    decisionContract,
    canonicalContext: composedFinalContext.canonicalSemanticContext,
  })

  const provenance = synthesis.quality.finalResponseProvenance
  if (!provenance) throw new Error('CEO_RESPONSE_PERSISTENCE_PROVENANCE_MISSING')
  await persistCeoAssistantMessage({
    conversationId,
    content: synthesis.content,
    provenance,
    capturedTurnSequence,
  })
  await notifyMissionOutcome({ conversationId, content: synthesis.content, steps: result.steps }).catch(() => {})
  return result
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

        await executeScheduledRun(convId, sched.prompt)
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

            const result = await executeScheduledRun(convId, sched.prompt)
            console.log(`[schedules/tick] Background exec ${sched.id}: status=${result.executionStatus}, reason=${result.completionReason}`)
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
