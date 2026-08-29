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
import { executeExternalEvidencePlan, recoverExternalEvidencePlan } from '@/lib/ceo-evidence-executor'
import { renderEvidenceBundleForPrompt, type EvidenceBundle } from '@/lib/ceo-evidence-bundle'
import { verifyClaimEvidence } from '@/lib/ceo-claim-evidence-gate'
import { addEvidenceTraceEvent, completeEvidenceTrace, startEvidenceTrace, type EvidenceTrace } from '@/lib/ceo-evidence-trace'
import { composeCeoContext, type PersistedConversationRow, type PersistedMemoryRow, type CeoContextComposition } from '@/lib/ceo-context-composer'
import type { AttachmentMeta } from '@/lib/tools'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 240

type DeploymentIdentity = { deploymentId: string | null; releaseCommit: string | null }
function getDeploymentIdentity(): DeploymentIdentity {
  return { deploymentId: process.env.VERCEL_DEPLOYMENT_ID?.trim() || null, releaseCommit: process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null }
}

function sse(event: string, data: unknown): string {
  const identity = getDeploymentIdentity()
  // Every SSE envelope is stamped here with deployment and release identity.
  const payload = data && typeof data === 'object' && !Array.isArray(data)
    ? { ...(data as Record<string, unknown>), deploymentId: identity.deploymentId, releaseCommit: identity.releaseCommit }
    : { data, deploymentId: identity.deploymentId, releaseCommit: identity.releaseCommit }
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`
}

async function loadConversationContext(conversationId: string, currentUserMessage: string): Promise<{ rows: PersistedConversationRow[]; memories: PersistedMemoryRow[] }> {
  try {
    const conversation = await db.conversation.findUnique({
      where: { id: conversationId },
      select: { Message: { orderBy: { createdAt: 'asc' }, select: { role: true, content: true, createdAt: true } } },
    })
    const memories = await db.memory.findMany({ orderBy: { updatedAt: 'desc' }, take: 40, select: { key: true, value: true, category: true, updatedAt: true } })
    const rows = (conversation?.Message ?? []).map((row) => ({ role: row.role, content: row.content, createdAt: row.createdAt }))
    if (!rows.length) rows.push({ role: 'user', content: currentUserMessage, createdAt: new Date() })
    return { rows, memories }
  } catch (error) {
    console.warn('[api/agent] Conversation context load failed:', error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180))
    return { rows: [{ role: 'user', content: currentUserMessage, createdAt: new Date() }], memories: [] }
  }
}

function shouldInjectFullOrganizationContext(preRoute: ReturnType<typeof preRouteCeoRequest>): boolean {
  const contract = preRoute.executionContract
  return contract.intent !== 'conversation'
    || preRoute.missionRelevant
    || contract.evidenceClass !== 'none'
    || preRoute.taskClass === 'financial'
    || contract.executionRequirement === 'production'
}

function buildSystemPrompt(preRoute: ReturnType<typeof preRouteCeoRequest>, evidenceMessage = ''): string {
  const identity = 'You are Agent007, the CEO and executive intelligence of a governed AI organization. Answer the user directly, naturally, accurately, and without claiming unperformed actions or verification.'
  const governance = 'For self-assessment requests, evaluate readiness from governed internal organizational state; clearly distinguish known facts, inferred conclusions, current limitations, and unknowns. Do not invent live verification.'
  const organization = shouldInjectFullOrganizationContext(preRoute)
    ? `\n\n${getCanonicalOrganizationPrompt()}`
    : '\n\nCEO IDENTITY CONTEXT: You are CEO_AGENT007. Prioritize natural, direct conversation and the user’s immediate intent.'
  return `${identity} ${governance}${evidenceMessage}${organization}`
}

export async function POST(req: NextRequest) {
  await ensureDbReady().catch(() => {})
  let body: any
  try { body = await req.json() } catch { return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } }) }
  const { message, conversationId, attachments, language } = body as { message?: string; conversationId?: string; attachments?: AttachmentMeta[]; language?: 'en' | 'zh' }
  if (!message || typeof message !== 'string') return new Response(JSON.stringify({ error: 'Missing "message"' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  if (!conversationId || typeof conversationId !== 'string') return new Response(JSON.stringify({ error: 'Missing "conversationId"' }), { status: 400, headers: { 'Content-Type': 'application/json' }) }
  const lang: 'en' | 'zh' = language === 'zh' ? 'zh' : 'en'
  const atts: AttachmentMeta[] = Array.isArray(attachments) ? attachments : []
  const deploymentIdentity = getDeploymentIdentity()

  try {
    let conv = await db.conversation.findUnique({ where: { id: conversationId } })
    if (!conv) conv = await db.conversation.create({ data: { id: conversationId, title: message.slice(0, 50) } })
    await db.message.create({ data: { conversationId, role: 'user', content: message, attachments: atts.length ? JSON.stringify(atts.map(stripDataUrl)) : null } })
  } catch (dbErr: any) {
    console.warn('[api/agent] Pre-stream DB persistence failed:', dbErr?.message?.slice(0, 150))
  }

  const contextData = await loadConversationContext(conversationId, message)
  const contextSeed: CeoContextComposition = composeCeoContext({
    systemPrompt: 'You are Agent007, the CEO and executive intelligence of a governed AI organization. Understand the user naturally and use prior conversation context when relevant.',
    currentUserMessage: message,
    persistedMessages: contextData.rows,
    memories: contextData.memories,
  })
  const preRoute = preRouteCeoRequest(contextSeed.messages, atts.length)
  const resolvedPath = resolvePreRoute(preRoute)
  const executionContract = preRoute.executionContract
  const requestBudgetMs = Math.min(AGENT_REQUEST_BUDGET_MS, executionContract.latencyBudgetMs)

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const safeEnqueue = (value: string) => {
        if (closed) return
        try { controller.enqueue(encoder.encode(value)) } catch { closed = true }
      }
      const baseEmit: OrchestratorEventEmit = async (event: string, data: any) => safeEnqueue(sse(event, data))
      const recoveryBudget = new RecoveryBudget(executionContract)
      const emit: OrchestratorEventEmit = async (event: string, data: any) => {
        const recoveryEvent = event === 'thought' ? recoveryEventFromMessage(data?.content) : null
        if (recoveryEvent) {
          const decision = recoveryBudget.consume(recoveryEvent)
          if (!decision.allowed) throw new RecoveryBudgetExceededError(decision.count, decision.maxRecoveries, decision.reason)
          await baseEmit('progress', { phase: 'recovery', event: recoveryEvent, count: decision.count, maxRecoveries: decision.count + recoveryBudget.remaining })
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
          let externalEvidenceBundle: EvidenceBundle | undefined
          let evidenceTrace: EvidenceTrace | undefined

          if (executionContract.evidenceClass === 'external_web' || executionContract.evidenceClass === 'mixed') {
            evidenceTrace = startEvidenceTrace({ objective: message, profile: executionContract.evidenceProfile })
            const evidencePlan = buildExternalEvidencePlan({ objective: message, evidenceClass: executionContract.evidenceClass, domain: executionContract.domain, operation: executionContract.operation, temporalScope: executionContract.temporalScope, evidenceProfile: executionContract.evidenceProfile })
            addEvidenceTraceEvent(evidenceTrace, 'planned', { queryCount: evidencePlan.queries.length, minimumSources: evidencePlan.minimumSources })
            safeEnqueue(sse('progress', { phase: 'evidence_acquisition', profile: evidencePlan.profile, queryCount: evidencePlan.queries.length, minimumSources: evidencePlan.minimumSources }))
            let evidenceExecution = await executeExternalEvidencePlan(evidencePlan)
            addEvidenceTraceEvent(evidenceTrace, 'search_completed', { attemptedQueries: evidenceExecution.attemptedQueries, successfulQueries: evidenceExecution.successfulQueries, sources: evidenceExecution.bundle.sources.length, sufficient: evidenceExecution.bundle.sufficient })
            if (!evidenceExecution.bundle.sufficient) {
              addEvidenceTraceEvent(evidenceTrace, 'recovery_started', { reason: 'Initial evidence bundle did not meet sufficiency requirements.' })
              safeEnqueue(sse('progress', { phase: 'evidence_recovery', reason: 'Initial evidence bundle was insufficient; running a separate evidence-recovery pass.' }))
              try {
                const recovered = await recoverExternalEvidencePlan(evidencePlan)
                addEvidenceTraceEvent(evidenceTrace, 'recovery_completed', { sources: recovered.bundle.sources.length, sufficient: recovered.bundle.sufficient, failures: recovered.failures.length })
                if (recovered.bundle.sources.length > evidenceExecution.bundle.sources.length || recovered.bundle.sufficient) evidenceExecution = recovered
              } catch (recoveryError) {
                addEvidenceTraceEvent(evidenceTrace, 'recovery_completed', { sources: 0, sufficient: false, error: recoveryError instanceof Error ? recoveryError.message.slice(0, 200) : String(recoveryError).slice(0, 200) })
              }
            }
            externalEvidenceBundle = evidenceExecution.bundle
            if (externalEvidenceBundle.sources.length > 0) {
              externalEvidenceContext = renderEvidenceBundleForPrompt(externalEvidenceBundle)
              externalEvidenceScope = externalEvidenceBundle.scope === 'mixed' ? 'mixed' : 'external_web'
              externalEvidenceFreshness = externalEvidenceBundle.freshness
            }
            addEvidenceTraceEvent(evidenceTrace, externalEvidenceBundle.sufficient ? 'source_accepted' : 'source_rejected', { sources: externalEvidenceBundle.sources.length, sufficient: externalEvidenceBundle.sufficient })
            safeEnqueue(sse('progress', { phase: 'evidence_complete', sources: externalEvidenceBundle.sources.length, claims: externalEvidenceBundle.claims.length, sufficient: externalEvidenceBundle.sufficient, attemptedQueries: evidenceExecution.attemptedQueries, successfulQueries: evidenceExecution.successfulQueries, pageReads: evidenceExecution.pageReads, secSources: evidenceExecution.secSources, failures: evidenceExecution.failures.slice(0, 5) }))
          }

          const evidenceMessage = externalEvidenceContext
            ? `\n\n${externalEvidenceContext}\n\nUse only these source-backed facts for current external claims. Keep source markers such as [S1-...] attached to supported claims. If a needed fact is missing, say so instead of inventing it.`
            : ''
          const finalSystemPrompt = buildSystemPrompt(preRoute, evidenceMessage)
          const composed = composeCeoContext({ systemPrompt: finalSystemPrompt, currentUserMessage: message, persistedMessages: contextData.rows, memories: contextData.memories })
          let response = await runCeoCognitiveLifecycle({ attachmentsCount: atts.length, messages: composed.messages, taskType: preRoute.taskClass, verification: 'standard', timeoutMs: executionContract.latencyBudgetMs, contextualEvidence: externalEvidenceContext, evidenceScope: externalEvidenceScope, evidenceFreshness: externalEvidenceFreshness })
          if (externalEvidenceBundle && externalEvidenceBundle.sources.length > 0) {
            const claimVerification = verifyClaimEvidence(response.content, externalEvidenceBundle)
            addEvidenceTraceEvent(evidenceTrace!, 'gate_evaluated', { passed: claimVerification.passed, requiredClaims: claimVerification.requiredClaimCount, supportedClaims: claimVerification.supportedClaimCount })
            if (!claimVerification.passed) response = { ...response, content: `${response.content}\n\n**Evidence verification:** Some external claims could not be mapped to sufficiently fresh source evidence. I have not treated those claims as verified.`, evidenceState: 'PARTIAL_UNCONFIRMED', degraded: true, quality: { ...response.quality, decision: 'DEGRADED', evidenceState: 'PARTIAL_UNCONFIRMED', checks: { ...response.quality.checks, evidenceDiscipline: false }, claimScopes: response.quality.claimScopes, reasons: [...response.quality.reasons, 'Claim-aware evidence verification found unsupported external claims.'] } }
          }
          const finalTraceState = response.degraded ? (externalEvidenceBundle?.sources.length ? 'PARTIAL' : 'ABSTAIN') : 'FULL'
          if (evidenceTrace && !evidenceTrace.completedAt) {
            addEvidenceTraceEvent(evidenceTrace, response.degraded ? 'abstained' : 'completed', { finalState: finalTraceState })
            completeEvidenceTrace(evidenceTrace, finalTraceState)
          }
          let persistedAssistantMessageId: string | null = null
          try { const assistant = await db.message.create({ data: { conversationId, role: 'assistant', content: response.content } }); persistedAssistantMessageId = assistant.id } catch (persistErr: any) { console.warn('[api/agent] CEO-lane assistant persistence failed:', persistErr?.message?.slice(0, 150)) }
          safeEnqueue(sse('answer', { content: response.content, provider: response.provider, model: response.model, executionClass: response.decisionPlan.path, evidenceState: response.evidenceState, quality: response.quality, responseMs: response.responseMs, deployment: deploymentIdentity, executionContract, evidenceTrace, context: { recentMessages: contextSeed.recentMessages, relevantOlderMessages: contextSeed.relevantOlderMessages, summarizedOlderMessages: contextSeed.summarizedOlderMessages, selectedMemoryKeys: contextSeed.selectedMemoryKeys } }))
          safeEnqueue(sse('done', { messageId: persistedAssistantMessageId, steps: executionContract.evidenceClass === 'external_web' ? 2 : 1, executionClass: response.decisionPlan.path, provider: response.provider, model: response.model, evidenceState: response.evidenceState, deployment: deploymentIdentity, executionContract }))
        } else {
          const composedOperational = composeCeoContext({ systemPrompt: buildSystemPrompt(preRoute), currentUserMessage: message, persistedMessages: contextData.rows, memories: contextData.memories })
          const result = await withOrchestrationOwner('operational_orchestrator', () => runWithAgentRequestBudget((signal) => runOrchestrator({ conversationId, userMessage: message, attachments: atts, language: lang, emit, signal } as OrchestratorRunOptionsWithSignal), requestBudgetMs))
          const operationalEvidence = `OPERATIONAL EXECUTION RESULT\nFinal answer: ${result.finalAnswer.slice(0, 24000)}\nCompleted steps: ${result.steps.length}\nTool steps: ${result.steps.filter((step) => Boolean(step.toolName)).length}`
          const synthesis = await runCeoCognitiveLifecycle({ attachmentsCount: atts.length, messages: [...composedOperational.messages, { role: 'user', content: operationalEvidence }], taskType: preRoute.taskClass, verification: 'standard', timeoutMs: Math.min(60000, requestBudgetMs), contextualEvidence: operationalEvidence, evidenceScope: 'internal_state', evidenceFreshness: { observedAt: Date.now(), maxAgeMs: 300000 } })
          const persistedAssistantMessageId = result.persistedAssistantMessageId
          try { await db.message.update({ where: { id: result.persistedAssistantMessageId }, data: { content: synthesis.content } }) } catch (persistErr: any) { console.warn('[api/agent] Operational synthesis history update failed:', persistErr?.message?.slice(0, 150)) }
          safeEnqueue(sse('answer', { content: synthesis.content, provider: synthesis.provider, model: synthesis.model, executionClass: synthesis.decisionPlan.path, evidenceState: synthesis.evidenceState, quality: synthesis.quality, responseMs: synthesis.responseMs, deployment: deploymentIdentity, executionContract, operationalSteps: result.steps.length }))
          safeEnqueue(sse('done', { messageId: persistedAssistantMessageId, steps: result.steps.length + 1, executionClass: synthesis.decisionPlan.path, provider: synthesis.provider, model: synthesis.model, evidenceState: synthesis.evidenceState, deployment: deploymentIdentity, executionContract, recoveryCount: recoveryBudget.used }))
        }
      } catch (e: any) {
        if (e instanceof RecoveryBudgetExceededError || e?.code === 'CEO_RECOVERY_BUDGET_EXCEEDED') await baseEmit('error', { message: 'Agent007 stopped this request after exhausting its governed recovery budget. The request state remains safe; retry is available.', executionClass: resolvedPath, code: 'CEO_RECOVERY_BUDGET_EXCEEDED', recoveryCount: recoveryBudget.used, maxRecoveries: recoveryBudget.remaining + recoveryBudget.used, retryable: true, deployment: deploymentIdentity })
        else if (e instanceof AgentRequestTimeoutError || e?.code === 'AGENT_REQUEST_TIMEOUT') await baseEmit('error', { message: 'Agent007 stopped this request before the execution budget so it can remain responsive. The work already persisted is safe; retry to continue from the durable state.', executionClass: resolvedPath, code: 'AGENT_REQUEST_TIMEOUT', timeoutMs: requestBudgetMs, retryable: true, deployment: deploymentIdentity })
        else await baseEmit('error', { message: e?.message ?? String(e), executionClass: resolvedPath, deployment: deploymentIdentity })
      } finally {
        clearInterval(heartbeat)
        endInteractive()
        try { controller.close() } catch { /* ignore */ }
        closed = true
      }
    },
    cancel() { /* client aborted; nothing to do */ },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'X-Agent007-Deployment-Id': deploymentIdentity.deploymentId ?? 'unknown', 'X-Agent007-Release-Commit': deploymentIdentity.releaseCommit ?? 'unknown' } })
}

interface OrchestratorRunOptionsWithSignal { conversationId: string; userMessage: string; attachments: AttachmentMeta[]; language: 'en' | 'zh'; emit: OrchestratorEventEmit; signal: AbortSignal }
function stripDataUrl(a: AttachmentMeta) { return { filename: a.filename, originalName: a.originalName, mimeType: a.mimeType, size: a.size, textContent: a.textContent ? a.textContent.slice(0, 8000) : undefined } }
