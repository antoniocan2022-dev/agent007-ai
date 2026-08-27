import { NextRequest } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { runOrchestrator, type OrchestratorEventEmit } from '@/lib/orchestrator'
import { beginInteractive, endInteractive } from '@/lib/load-tracker'
import { runCeoCognitiveLifecycle } from '@/lib/ceo-cognitive-lifecycle'
import { preRouteCeoRequest, resolvePreRoute } from '@/lib/ceo-pre-router'
import { withOrchestrationOwner } from '@/lib/ceo-execution-owner'
import { RecoveryBudget, RecoveryBudgetExceededError, recoveryEventFromMessage } from '@/lib/ceo-recovery-policy'
import { getCanonicalOrganizationPrompt } from '@/lib/canonical-organization-prompt'
import { AgentRequestTimeoutError, AGENT_REQUEST_BUDGET_MS, runWithAgentRequestBudget } from '@/lib/agent-request-budget'
import type { AttachmentMeta } from '@/lib/tools'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Keep a safety margin below Vercel's 300s hard ceiling so a request can
// close cleanly before the platform kills the function.
export const maxDuration = 240

function sse(event: string, data: any): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export async function POST(req: NextRequest) {
  await ensureDbReady().catch(() => {})

  let body: any
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const { message, conversationId, attachments, language } = body as {
    message?: string
    conversationId?: string
    attachments?: AttachmentMeta[]
    language?: 'en' | 'zh'
  }

  if (!message || typeof message !== 'string') {
    return new Response(JSON.stringify({ error: 'Missing "message"' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }
  if (!conversationId || typeof conversationId !== 'string') {
    return new Response(JSON.stringify({ error: 'Missing "conversationId"' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const lang: 'en' | 'zh' = language === 'zh' ? 'zh' : 'en'
  const atts: AttachmentMeta[] = Array.isArray(attachments) ? attachments : []
  const preRoute = preRouteCeoRequest([{ role: 'user', content: message }], atts.length)
  const resolvedPath = resolvePreRoute(preRoute)
  const executionContract = preRoute.executionContract
  const requestBudgetMs = Math.min(AGENT_REQUEST_BUDGET_MS, executionContract.latencyBudgetMs)

  try {
    let conv = await db.conversation.findUnique({ where: { id: conversationId } })
    if (!conv) conv = await db.conversation.create({ data: { id: conversationId, title: message.slice(0, 50) } })
    await db.message.create({
      data: {
        conversationId,
        role: 'user',
        content: message,
        attachments: atts.length ? JSON.stringify(atts.map(stripDataUrl)) : null,
      },
    })
  } catch (dbErr: any) {
    console.warn('[api/agent] Pre-stream DB persistence failed:', dbErr?.message?.slice(0, 150))
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const safeEnqueue = (s: string) => {
        if (closed) return
        try { controller.enqueue(encoder.encode(s)) } catch { closed = true }
      }
      const baseEmit: OrchestratorEventEmit = async (event: string, data: any) => safeEnqueue(sse(event, data))
      const recoveryBudget = new RecoveryBudget(executionContract)
      const emit: OrchestratorEventEmit = async (event: string, data: any) => {
        const recoveryEvent = event === 'thought' ? recoveryEventFromMessage(data?.content) : null
        if (recoveryEvent) {
          const decision = recoveryBudget.consume(recoveryEvent)
          if (!decision.allowed) {
            throw new RecoveryBudgetExceededError(decision.count, decision.maxRecoveries, decision.reason)
          }
          await baseEmit('progress', {
            phase: 'recovery',
            event: recoveryEvent,
            count: decision.count,
            maxRecoveries: decision.maxRecoveries,
            reason: decision.reason,
          })
        }
        await baseEmit(event, data)
      }
      const heartbeat = setInterval(() => safeEnqueue(sse('ping', { ts: Date.now() })), 5000)

      beginInteractive()
      try {
        if (executionContract.orchestrationOwner === 'ceo_lifecycle') {
          safeEnqueue(sse('progress', {
            phase: preRoute.executionContract.intent === 'self_assessment' ? 'self_assessment' : 'fast_lane',
            route: preRoute.route,
            reason: preRoute.reason,
            taskClass: preRoute.taskClass,
            executionContract: {
              intent: executionContract.intent,
              evidenceRequirement: executionContract.evidenceRequirement,
              executionRequirement: executionContract.executionRequirement,
              orchestrationOwner: executionContract.orchestrationOwner,
              maxTurns: executionContract.maxTurns,
              maxRecoveries: executionContract.maxRecoveries,
              latencyBudgetMs: executionContract.latencyBudgetMs,
            },
          }))

          const response = await runCeoCognitiveLifecycle({
            attachmentsCount: atts.length,
            messages: [
              {
                role: 'system',
                content: `You are Agent007, the CEO and executive intelligence of a governed AI organization. Answer the user directly, naturally, accurately, and without claiming unperformed actions or verification. For self-assessment requests, evaluate readiness from governed internal organizational state; clearly distinguish known facts, inferred conclusions, current limitations, and unknowns. Do not invent live verification.\n\n${getCanonicalOrganizationPrompt()}`,
              },
              { role: 'user', content: message },
            ],
            taskType: preRoute.taskClass,
            verification: 'standard',
            timeoutMs: executionContract.latencyBudgetMs,
          })

          let persistedAssistantMessageId: string | null = null
          try {
            const assistant = await db.message.create({ data: { conversationId, role: 'assistant', content: response.content } })
            persistedAssistantMessageId = assistant.id
          } catch (persistErr: any) {
            console.warn('[api/agent] CEO-lane assistant persistence failed:', persistErr?.message?.slice(0, 150))
          }

          safeEnqueue(sse('answer', {
            content: response.content,
            provider: response.provider,
            model: response.model,
            executionClass: response.decisionPlan.path,
            evidenceState: response.evidenceState,
            quality: response.quality,
            responseMs: response.responseMs,
            executionContract,
          }))
          safeEnqueue(sse('done', {
            messageId: persistedAssistantMessageId,
            steps: 1,
            executionClass: response.decisionPlan.path,
            provider: response.provider,
            model: response.model,
            evidenceState: response.evidenceState,
            executionContract,
          }))
        } else {
          // Operational requests are owned by the operational orchestrator for
          // the lifetime of this async context. The canonical bridge detects
          // that owner and uses the provider runtime directly, preventing the
          // orchestrator from recursively re-entering the CEO lifecycle.
          const result = await withOrchestrationOwner('operational_orchestrator', () => runWithAgentRequestBudget(
            (signal) => runOrchestrator({
              conversationId,
              userMessage: message,
              attachments: atts,
              language: lang,
              emit,
              signal,
            } as OrchestratorRunOptionsWithSignal),
            requestBudgetMs,
          ))
          safeEnqueue(sse('done', {
            messageId: result.persistedAssistantMessageId,
            steps: result.steps.length,
            executionClass: preRoute.adaptiveExecutionClass ?? 'standard',
            executionContract,
            recoveryCount: recoveryBudget.used,
          }))
        }
      } catch (e: any) {
        if (e instanceof RecoveryBudgetExceededError || e?.code === 'CEO_RECOVERY_BUDGET_EXCEEDED') {
          await baseEmit('error', {
            message: 'Agent007 stopped this request after exhausting its governed recovery budget. The request state remains safe; retry is available.',
            executionClass: resolvedPath,
            code: 'CEO_RECOVERY_BUDGET_EXCEEDED',
            recoveryCount: recoveryBudget.used,
            maxRecoveries: recoveryBudget.remaining + recoveryBudget.used,
            retryable: true,
          })
        } else if (e instanceof AgentRequestTimeoutError || e?.code === 'AGENT_REQUEST_TIMEOUT') {
          await baseEmit('error', {
            message: 'Agent007 stopped this request before the execution budget so it can remain responsive. The work already persisted is safe; retry to continue from the durable state.',
            executionClass: resolvedPath,
            code: 'AGENT_REQUEST_TIMEOUT',
            timeoutMs: requestBudgetMs,
            retryable: true,
          })
        } else {
          safeEnqueue(sse('error', { message: e?.message ?? String(e), executionClass: resolvedPath }))
        }
      } finally {
        clearInterval(heartbeat)
        endInteractive()
        try { controller.close() } catch { /* ignore */ }
        closed = true
      }
    },
    cancel() { /* client aborted; nothing to do */ },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

interface OrchestratorRunOptionsWithSignal {
  conversationId: string
  userMessage: string
  attachments: AttachmentMeta[]
  language: 'en' | 'zh'
  emit: OrchestratorEventEmit
  signal: AbortSignal
}

function stripDataUrl(a: AttachmentMeta) {
  return {
    filename: a.filename,
    originalName: a.originalName,
    mimeType: a.mimeType,
    size: a.size,
    textContent: a.textContent ? a.textContent.slice(0, 8000) : undefined,
  }
}
