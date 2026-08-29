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
import { buildExternalEvidencePlan } from '@/lib/ceo-evidence-planner'
import { executeExternalEvidencePlan } from '@/lib/ceo-evidence-executor'
import { renderEvidenceBundleForPrompt } from '@/lib/ceo-evidence-bundle'
import type { AttachmentMeta } from '@/lib/tools'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 240

type DeploymentIdentity = {
  deploymentId: string | null
  releaseCommit: string | null
}

function getDeploymentIdentity(): DeploymentIdentity {
  return {
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID?.trim() || null,
    releaseCommit: process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null,
  }
}

function sse(event: string, data: unknown): string {
  const identity = getDeploymentIdentity()
  const payload = data && typeof data === 'object' && !Array.isArray(data)
    ? { ...(data as Record<string, unknown>), deploymentId: identity.deploymentId, releaseCommit: identity.releaseCommit }
    : { data, deploymentId: identity.deploymentId, releaseCommit: identity.releaseCommit }
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`
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
  const deploymentIdentity = getDeploymentIdentity()

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
          if (!decision.allowed) throw new RecoveryBudgetExceededError(decision.count, decision.maxRecoveries, decision.reason)
          await baseEmit('progress', { phase: 'recovery', event: recoveryEvent, count: decision.count, maxRecoveries: decision.maxRecoveries, reason: decision.reason })
        }
        await baseEmit(event, data)
      }
      const heartbeat = setInterval(() => safeEnqueue(sse('ping', { ts: Date.now() })), 5000)

      beginInteractive()
      try {
        if (executionContract.orchestrationOwner === 'ceo_lifecycle') {
          let externalEvidenceContext: string | undefined
          let externalEvidenceScope: 'external_web' | 'mixed' | undefined
          let externalEvidenceFreshness: { observedAt: number; maxAgeMs: number } | undefined

          safeEnqueue(sse('progress', {
            phase: executionContract.evidenceClass === 'external_web' ? 'evidence_aware' : (executionContract.intent === 'self_assessment' ? 'self_assessment' : 'fast_lane'),
            route: preRoute.route,
            reason: preRoute.reason,
            taskClass: preRoute.taskClass,
            deployment: deploymentIdentity,
            executionContract,
          }))

          if (executionContract.evidenceClass === 'external_web' || executionContract.evidenceClass === 'mixed') {
            const evidencePlan = buildExternalEvidencePlan({
              objective: message,
              evidenceClass: executionContract.evidenceClass,
              domain: executionContract.domain,
              operation: executionContract.operation,
              temporalScope: executionContract.temporalScope,
              evidenceProfile: executionContract.evidenceProfile,
            })
            safeEnqueue(sse('progress', {
              phase: 'evidence_acquisition',
              profile: evidencePlan.profile,
              queryCount: evidencePlan.queries.length,
              minimumSources: evidencePlan.minimumSources,
            }))
            try {
              const evidenceExecution = await executeExternalEvidencePlan(evidencePlan)
              if (evidenceExecution.bundle.sources.length > 0) {
                externalEvidenceContext = renderEvidenceBundleForPrompt(evidenceExecution.bundle)
                externalEvidenceScope = evidenceExecution.bundle.scope === 'mixed' ? 'mixed' : 'external_web'
                externalEvidenceFreshness = evidenceExecution.bundle.freshness
              }
              safeEnqueue(sse('progress', {
                phase: 'evidence_complete',
                sources: evidenceExecution.bundle.sources.length,
                claims: evidenceExecution.bundle.claims.length,
                attemptedQueries: evidenceExecution.attemptedQueries,
                successfulQueries: evidenceExecution.successfulQueries,
                pageReads: evidenceExecution.pageReads,
                secSources: evidenceExecution.secSources,
                failures: evidenceExecution.failures.slice(0, 5),
              }))
            } catch (e: any) {
              safeEnqueue(sse('progress', {
                phase: 'evidence_failed',
                error: String(e?.message ?? e).slice(0, 500),
                fallback: 'The CEO will not invent current external facts; the final answer will be limited by the evidence state.',
              }))
            }
          }

          const evidenceMessage = externalEvidenceContext
            ? `\n\n${externalEvidenceContext}\n\nUse only these source-backed facts for current external claims. Keep source markers such as [S1-...] attached to supported claims. If a needed fact is missing, say so instead of inventing it.`
            : ''

          const response = await runCeoCognitiveLifecycle({
            attachmentsCount: atts.length,
            messages: [
              {
                role: 'system',
                content: `You are Agent007, the CEO and executive intelligence of a governed AI organization. Answer the user directly, naturally, accurately, and without claiming unperformed actions or verification. For self-assessment requests, evaluate readiness from governed internal organizational state; clearly distinguish known facts, inferred conclusions, current limitations, and unknowns. Do not invent live verification.${evidenceMessage}\n\n${getCanonicalOrganizationPrompt()}`,
              },
              { role: 'user', content: message },
            ],
            taskType: preRoute.taskClass,
            verification: 'standard',
            timeoutMs: executionContract.latencyBudgetMs,
            contextualEvidence: externalEvidenceContext,
            evidenceScope: externalEvidenceScope,
            evidenceFreshness: externalEvidenceFreshness,
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
            deployment: deploymentIdentity,
            executionContract,
          }))
          safeEnqueue(sse('done', {
            messageId: persistedAssistantMessageId,
            steps: executionContract.evidenceClass === 'external_web' ? 2 : 1,
            executionClass: response.decisionPlan.path,
            provider: response.provider,
            model: response.model,
            evidenceState: response.evidenceState,
            deployment: deploymentIdentity,
            executionContract,
          }))
        } else {
          const result = await withOrchestrationOwner('operational_orchestrator', () => runWithAgentRequestBudget(
            (signal) => runOrchestrator({ conversationId, userMessage: message, attachments: atts, language: lang, emit, signal } as OrchestratorRunOptionsWithSignal),
            requestBudgetMs,
          ))
          safeEnqueue(sse('done', {
            messageId: result.persistedAssistantMessageId,
            steps: result.steps.length,
            executionClass: preRoute.adaptiveExecutionClass ?? 'standard',
            executionContract,
            deployment: deploymentIdentity,
            recoveryCount: recoveryBudget.used,
          }))
        }
      } catch (e: any) {
        if (e instanceof RecoveryBudgetExceededError || e?.code === 'CEO_RECOVERY_BUDGET_EXCEEDED') {
          await baseEmit('error', { message: 'Agent007 stopped this request after exhausting its governed recovery budget. The request state remains safe; retry is available.', executionClass: resolvedPath, code: 'CEO_RECOVERY_BUDGET_EXCEEDED', recoveryCount: recoveryBudget.used, maxRecoveries: recoveryBudget.remaining + recoveryBudget.used, retryable: true, deployment: deploymentIdentity })
        } else if (e instanceof AgentRequestTimeoutError || e?.code === 'AGENT_REQUEST_TIMEOUT') {
          await baseEmit('error', { message: 'Agent007 stopped this request before the execution budget so it can remain responsive. The work already persisted is safe; retry to continue from the durable state.', executionClass: resolvedPath, code: 'AGENT_REQUEST_TIMEOUT', timeoutMs: requestBudgetMs, retryable: true, deployment: deploymentIdentity })
        } else {
          safeEnqueue(sse('error', { message: e?.message ?? String(e), executionClass: resolvedPath, deployment: deploymentIdentity }))
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
      'X-Agent007-Deployment-Id': deploymentIdentity.deploymentId ?? 'unknown',
      'X-Agent007-Release-Commit': deploymentIdentity.releaseCommit ?? 'unknown',
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