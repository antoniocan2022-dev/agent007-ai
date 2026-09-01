import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { db, ensureDbReady } from '@/lib/db'
import { authOptions } from '@/lib/auth'
import { runOrchestrator, type OrchestratorEventEmit } from '@/lib/orchestrator'
import { beginInteractive, endInteractive } from '@/lib/load-tracker'
import { runCeoCognitiveLifecycle } from '@/lib/ceo-cognitive-lifecycle'
import { preRouteCeoRequest, resolvePreRoute } from '@/lib/ceo-pre-router'
import { withOrchestrationOwner } from '@/lib/ceo-execution-owner'
import { RecoveryBudget, RecoveryBudgetExceededError, recoveryEventFromMessage } from '@/lib/ceo-recovery-policy'
import { AgentRequestTimeoutError, AGENT_REQUEST_BUDGET_MS, runWithAgentRequestBudget } from '@/lib/agent-request-budget'
import { buildExternalEvidencePlan } from '@/lib/ceo-evidence-planner'
import { executeExternalEvidencePlan, recoverExternalEvidencePlan } from '@/lib/ceo-evidence-executor'
import { renderEvidenceBundleForPrompt, type EvidenceBundle } from '@/lib/ceo-evidence-bundle'
import { verifyClaimEvidence } from '@/lib/ceo-claim-evidence-gate'
import { addEvidenceTraceEvent, completeEvidenceTrace, startEvidenceTrace, type EvidenceTrace } from '@/lib/ceo-evidence-trace'
import { buildCeoContextModules, composeCeoContext, type PersistedConversationRow, type PersistedMemoryRow, type CeoContextComposition } from '@/lib/ceo-context-composer'
import { buildConversationDecisionContract } from '@/lib/ceo-conversation-decision-contract'
import { buildCeoRuntimeMetrics, logCeoRuntimeMetrics } from '@/lib/ceo-runtime-metrics'
import { createReleaseAttestation, getReleaseIdentity, newReleaseRequestId } from '@/lib/release-attestation'
import { CeoRequestAbortedError, isCeoRequestAborted } from '@/lib/ceo-cancellation'
import { runWithCeoCancellationContext } from '@/lib/ceo-cancellation-context'
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
  const payload = data && typeof data === 'object' && !Array.isArray(data)
    ? { ...(data as Record<string, unknown>), deploymentId: identity.deploymentId, releaseCommit: identity.releaseCommit }
    : { data, deploymentId: identity.deploymentId, releaseCommit: identity.releaseCommit }
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`
}

async function loadConversationContext(conversationId: string, userId: string): Promise<{ rows: PersistedConversationRow[]; memories: PersistedMemoryRow[] }> {
  try {
    const conversation = await db.conversation.findFirst({
      where: { id: conversationId, userId },
      select: { Message: { orderBy: { createdAt: 'asc' }, select: { role: true, content: true, createdAt: true } } },
    })
    const memories = await db.memory.findMany({ orderBy: { updatedAt: 'desc' }, take: 40, select: { key: true, value: true, category: true, updatedAt: true } })
    const rows = (conversation?.Message ?? []).map((row) => ({ role: row.role, content: row.content, createdAt: row.createdAt }))
    return { rows, memories }
  } catch (error) {
    console.warn('[api/agent] Conversation context load failed:', error instanceof Error ? error.message.slice(0, 180) : String(error))
    return { rows: [], memories: [] }
  }
}

function buildSystemPrompt(): string {
  const identity = 'You are Agent007, the CEO and executive intelligence of a governed AI organization. Answer the user directly, naturally, accurately, and without claiming unperformed actions or verification.'
  const personality = 'Have a genuine point of view rather than hedging everything into neutrality: when asked for a recommendation or priority, pick one and explain your reasoning with real conviction, the way a thoughtful executive would. Be curious about the person you are talking to -- ask a natural follow-up question when it would genuinely move the conversation forward, not as a formality on every reply. Write the way a sharp, engaged colleague talks, not a compliance document: plain language over jargon, contractions where they read naturally, and no unnecessary hedging or filler.'
  const governance = 'For self-assessment requests, evaluate readiness from governed internal organizational state; clearly distinguish known facts, inferred conclusions, current limitations, and unknowns. Do not invent live verification.'
  return `${identity} ${personality} ${governance}`
}

export async function POST(req: NextRequest) {
  await ensureDbReady().catch(() => {})
  const session = await getServerSession(authOptions)
  const sessionUserId = typeof (session?.user as { id?: unknown } | undefined)?.id === 'string' ? (session!.user as { id: string }).id : ''
  if (!sessionUserId) return new Response(JSON.stringify({ error: 'Authentication required.' }), { status: 401, headers: { 'Content-Type': 'application/json' } })

  let body: any
  try { body = await req.json() } catch { return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } }) }
  const { message, conversationId, attachments, language } = body as { message?: string; conversationId?: string; attachments?: AttachmentMeta[]; language?: 'en' | 'zh' }
  if (!message || typeof message !== 'string') return new Response(JSON.stringify({ error: 'Missing \"message\"' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  if (!conversationId || typeof conversationId !== 'string') return new Response(JSON.stringify({ error: 'Missing \"conversationId\"' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  const lang: 'en' | 'zh' = language === 'zh' ? 'zh' : 'en'
  const atts: AttachmentMeta[] = Array.isArray(attachments) ? attachments : []
  const releaseIdentity = getReleaseIdentity()
  const deploymentIdentity: DeploymentIdentity = { deploymentId: releaseIdentity.deploymentId, releaseCommit: releaseIdentity.vercelCommitSha }
  const requestId = newReleaseRequestId(req.headers.get('x-agent007-request-id'))
  const releaseAttestation = createReleaseAttestation(releaseIdentity, requestId)
  const requestAbortController = new AbortController()
  const onRequestAbort = () => requestAbortController.abort(req.signal.reason ?? new CeoRequestAbortedError(req.signal.reason))
  if (req.signal.aborted) onRequestAbort()
  else req.signal.addEventListener('abort', onRequestAbort, { once: true })

  let contextData: { rows: PersistedConversationRow[]; memories: PersistedMemoryRow[] }
  try {
    let conv = await db.conversation.findUnique({ where: { id: conversationId }, select: { id: true, userId: true } })
    if (conv && conv.userId !== sessionUserId) return new Response(JSON.stringify({ error: 'Conversation not found.' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    if (!conv) conv = await db.conversation.create({ data: { id: conversationId, title: message.slice(0, 50), userId: sessionUserId }, select: { id: true, userId: true } })
    contextData = await loadConversationContext(conversationId, sessionUserId)
    await db.message.create({ data: { conversationId: conv.id, role: 'user', content: message, attachments: atts.length ? JSON.stringify(atts.map(stripDataUrl)) : null } })
  } catch (dbErr: any) {
    req.signal.removeEventListener('abort', onRequestAbort)
    return new Response(JSON.stringify({ error: 'Unable to persist the conversation securely.' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
  }

  const contextSeed: CeoContextComposition = composeCeoContext({
    systemPrompt: buildSystemPrompt(),
    currentUserMessage: message,
    persistedMessages: contextData.rows,
    memories: contextData.memories,
  })
  const preRoute = preRouteCeoRequest(contextSeed.messages, atts.length)
  const resolvedPath = resolvePreRoute(preRoute)
  const executionContract = preRoute.executionContract
  const decisionContract = buildConversationDecisionContract(contextSeed.canonicalSemanticContext)
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
      let streamOutcome: 'completed' | 'degraded' | 'cancelled' | 'timeout' | 'failed' = 'failed'
      try {
        if (requestAbortController.signal.aborted) throw new CeoRequestAbortedError(requestAbortController.signal.reason)
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
          const finalSystemPrompt = buildSystemPrompt()
          const contextModules = buildCeoContextModules({
            intent: executionContract.intent,
            missionRelevant: preRoute.missionRelevant,
            evidenceClass: executionContract.evidenceClass,
            taskClass: preRoute.taskClass,
            executionRequirement: executionContract.executionRequirement,
            evidence: externalEvidenceContext,
          })
          const composed = composeCeoContext({ systemPrompt: finalSystemPrompt, currentUserMessage: message, persistedMessages: contextData.rows, memories: contextData.memories, modules: contextModules })
          let response = await runWithCeoCancellationContext(requestAbortController.signal, () => runCeoCognitiveLifecycle({ attachmentsCount: atts.length, messages: composed.messages, taskType: preRoute.taskClass, verification: 'standard', timeoutMs: executionContract.latencyBudgetMs, contextualEvidence: externalEvidenceContext, evidenceScope: externalEvidenceScope, evidenceFreshness: externalEvidenceFreshness, priorConversation: contextData.rows, relevantOlderConversation: contextData.rows }))
          if (externalEvidenceBundle && externalEvidenceBundle.sources.length > 0) {
            const claimVerification = verifyClaimEvidence(response.content, externalEvidenceBundle)
            addEvidenceTraceEvent(evidenceTrace!, 'gate_evaluated', { passed: claimVerification.passed, requiredClaims: claimVerification.requiredClaimCount, supportedClaims: claimVerification.supportedClaimCount })
            if (!claimVerification.passed) response = { ...response, content: `${response.content}\n\n**Evidence verification:** Some external claims could not be mapped to sufficiently fresh source evidence. I have not treated those claims as verified.`, evidenceState: 'PARTIAL_UNCONFIRMED', degraded: true, quality: { ...response.quality, decision: 'DEGRADED', evidenceState: 'PARTIAL_UNCONFIRMED', checks: { ...response.quality.checks, evidenceDiscipline: false }, claimScopes: response.quality.claimScopes, reasons: [...response.quality.reasons, 'Claim-aware evidence verification found unsupported external claims.'] } }
          }
          const finalTraceState = response.degraded ? (externalEvidenceBundle?.sources.length ? 'PARTIAL' : 'ABSTAIN') : 'FULL'
          if (evidenceTrace && !evidenceTrace.completedAt) { addEvidenceTraceEvent(evidenceTrace, response.degraded ? 'abstained' : 'completed', { finalState: finalTraceState }); completeEvidenceTrace(evidenceTrace, finalTraceState) }
          const metrics = buildCeoRuntimeMetrics({ result: response, decisionContract, outcome: response.degraded ? 'degraded' : 'completed' })
          logCeoRuntimeMetrics(metrics, requestId)
          let persistedAssistantMessageId: string | null = null
          try { const assistant = await db.message.create({ data: { conversationId, role: 'assistant', content: response.content } }); persistedAssistantMessageId = assistant.id } catch (persistErr: any) { console.warn('[api/agent] CEO-lane assistant persistence failed:', persistErr?.message?.slice(0, 150)) }
          streamOutcome = response.degraded ? 'degraded' : 'completed'
          console.log('[ceo-request-trace]', JSON.stringify({ requestId, endpoint: '/api/agent', deploymentId: releaseAttestation.deploymentId, executedCommitSha: releaseAttestation.executedCommitSha, fingerprint: releaseAttestation.fingerprint, outcome: streamOutcome, executionPath: response.decisionPlan.path, provider: response.provider, model: response.model }))
          safeEnqueue(sse('answer', { content: response.content, provider: response.provider, model: response.model, executionClass: response.decisionPlan.path, evidenceState: response.evidenceState, quality: response.quality, cognitiveMetrics: metrics, responseMs: response.responseMs, deployment: deploymentIdentity, requestId, releaseAttestation, decisionContract, executionContract, evidenceTrace, context: { recentMessages: contextSeed.recentMessages, relevantOlderMessages: contextSeed.relevantOlderMessages, summarizedOlderMessages: contextSeed.summarizedOlderMessages, selectedMemoryKeys: contextSeed.selectedMemoryKeys, modules: composed.modules } }))
          safeEnqueue(sse('done', { messageId: persistedAssistantMessageId, steps: executionContract.evidenceClass === 'external_web' ? 2 : 1, executionClass: response.decisionPlan.path, provider: response.provider, model: response.model, evidenceState: response.evidenceState, deployment: deploymentIdentity, requestId, releaseAttestation, cognitiveMetrics: metrics, decisionContract, executionContract }))
        } else {
          const operationalModules = buildCeoContextModules({ intent: executionContract.intent, missionRelevant: preRoute.missionRelevant, evidenceClass: executionContract.evidenceClass, taskClass: preRoute.taskClass, executionRequirement: executionContract.executionRequirement })
          const baseOperationalContext = composeCeoContext({ systemPrompt: buildSystemPrompt(), currentUserMessage: message, persistedMessages: contextData.rows, memories: contextData.memories, modules: operationalModules })
          const result = await withOrchestrationOwner('operational_orchestrator', () => runWithAgentRequestBudget((signal) => runOrchestrator({ conversationId, userMessage: message, attachments: atts, language: lang, emit, signal } as OrchestratorRunOptionsWithSignal), requestBudgetMs, requestAbortController.signal))
          const operationalEvidence = `OPERATIONAL EXECUTION RESULT\nFinal answer: ${result.finalAnswer.slice(0, 24000)}\nCompleted steps: ${result.steps.length}\nTool steps: ${result.steps.filter((step) => Boolean(step.toolName)).length}`
          const synthesisModules = buildCeoContextModules({ intent: executionContract.intent, missionRelevant: preRoute.missionRelevant, evidenceClass: executionContract.evidenceClass, taskClass: preRoute.taskClass, executionRequirement: executionContract.executionRequirement, execution: operationalEvidence })
          const composedOperational = composeCeoContext({ systemPrompt: buildSystemPrompt(), currentUserMessage: message, persistedMessages: contextData.rows, memories: contextData.memories, modules: synthesisModules })
          const synthesis = await runWithCeoCancellationContext(requestAbortController.signal, () => runCeoCognitiveLifecycle({ attachmentsCount: atts.length, messages: composedOperational.messages, taskType: preRoute.taskClass, verification: 'standard', timeoutMs: Math.min(60000, requestBudgetMs), contextualEvidence: operationalEvidence, evidenceScope: 'internal_state', evidenceFreshness: { observedAt: Date.now(), maxAgeMs: 300000 }, priorConversation: contextData.rows, relevantOlderConversation: contextData.rows }))
          const metrics = buildCeoRuntimeMetrics({ result: synthesis, decisionContract, outcome: synthesis.degraded ? 'degraded' : 'completed' })
          logCeoRuntimeMetrics(metrics, requestId)
          const persistedAssistantMessageId = result.persistedAssistantMessageId
          try { await db.message.update({ where: { id: result.persistedAssistantMessageId }, data: { content: synthesis.content } }) } catch (persistErr: any) { console.warn('[api/agent] Operational synthesis history update failed:', persistErr?.message?.slice(0, 150) ) }
          streamOutcome = synthesis.degraded ? 'degraded' : 'completed'
          console.log('[ceo-request-trace]', JSON.stringify({ requestId, endpoint: '/api/agent', deploymentId: releaseAttestation.deploymentId, executedCommitSha: releaseAttestation.executedCommitSha, fingerprint: releaseAttestation.fingerprint, outcome: streamOutcome, executionPath: synthesis.decisionPlan.path, provider: synthesis.provider, model: synthesis.model }))
          safeEnqueue(sse('answer', { content: synthesis.content, provider: synthesis.provider, model: synthesis.model, executionClass: synthesis.decisionPlan.path, evidenceState: synthesis.evidenceState, quality: synthesis.quality, cognitiveMetrics: metrics, responseMs: synthesis.responseMs, deployment: deploymentIdentity, requestId, releaseAttestation, decisionContract, executionContract, operationalSteps: result.steps.length, context: { recentMessages: baseOperationalContext.recentMessages, relevantOlderMessages: baseOperationalContext.relevantOlderMessages, summarizedOlderMessages: baseOperationalContext.summarizedOlderMessages, selectedMemoryKeys: baseOperationalContext.selectedMemoryKeys, modules: composedOperational.modules } }))
          safeEnqueue(sse('done', { messageId: persistedAssistantMessageId, steps: result.steps.length + 1, executionClass: synthesis.decisionPlan.path, provider: synthesis.provider, model: synthesis.model, evidenceState: synthesis.evidenceState, deployment: deploymentIdentity, requestId, releaseAttestation, cognitiveMetrics: metrics, decisionContract, executionContract, recoveryCount: recoveryBudget.used }))
        }
      } catch (e: any) {
        const cancelled = isCeoRequestAborted(e) || requestAbortController.signal.aborted
        if (cancelled) {
          streamOutcome = 'cancelled'
          console.log('[ceo-request-trace]', JSON.stringify({ requestId, endpoint: '/api/agent', deploymentId: releaseAttestation.deploymentId, executedCommitSha: releaseAttestation.executedCommitSha, fingerprint: releaseAttestation.fingerprint, outcome: 'cancelled' }))
          await baseEmit('error', { message: 'Agent007 stopped the request because it was cancelled. No assistant response was committed after cancellation.', executionClass: resolvedPath, code: 'CEO_REQUEST_ABORTED', retryable: true, requestId, releaseAttestation, deployment: deploymentIdentity })
        } else if (e instanceof RecoveryBudgetExceededError || e?.code === 'CEO_RECOVERY_BUDGET_EXCEEDED') {
          streamOutcome = 'failed'
          await baseEmit('error', { message: 'Agent007 stopped this request after exhausting its governed recovery budget. The request state remains safe; retry is available.', executionClass: resolvedPath, code: 'CEO_RECOVERY_BUDGET_EXCEEDED', recoveryCount: recoveryBudget.used, maxRecoveries: recoveryBudget.remaining + recoveryBudget.used, retryable: true, requestId, releaseAttestation, deployment: deploymentIdentity })
        } else if (e instanceof AgentRequestTimeoutError || e?.code === 'AGENT_REQUEST_TIMEOUT') {
          streamOutcome = 'timeout'
          console.log('[ceo-request-trace]', JSON.stringify({ requestId, endpoint: '/api/agent', deploymentId: releaseAttestation.deploymentId, executedCommitSha: releaseAttestation.executedCommitSha, fingerprint: releaseAttestation.fingerprint, outcome: 'timeout' }))
          await baseEmit('error', { message: 'Agent007 stopped this request before the execution budget so it can remain responsive. The work already persisted is safe; retry to continue from the durable state.', executionClass: resolvedPath, code: 'AGENT_REQUEST_TIMEOUT', timeoutMs: requestBudgetMs, retryable: true, requestId, releaseAttestation, deployment: deploymentIdentity })
        } else {
          streamOutcome = 'failed'
          console.log('[ceo-request-trace]', JSON.stringify({ requestId, endpoint: '/api/agent', deploymentId: releaseAttestation.deploymentId, executedCommitSha: releaseAttestation.executedCommitSha, fingerprint: releaseAttestation.fingerprint, outcome: 'failed', errorClass: e instanceof Error ? e.name : typeof e }))
          await baseEmit('error', { message: e?.message ?? String(e), executionClass: resolvedPath, requestId, releaseAttestation, deployment: deploymentIdentity })
        }
      } finally {
        clearInterval(heartbeat)
        endInteractive()
        req.signal.removeEventListener('abort', onRequestAbort)
        try { controller.close() } catch { /* ignore */ }
        closed = true
        if (streamOutcome !== 'completed' && streamOutcome !== 'degraded') console.log('[ceo-request-outcome]', JSON.stringify({ requestId, outcome: streamOutcome }))
      }
    },
    cancel(reason) { requestAbortController.abort(reason ?? new CeoRequestAbortedError(reason)) },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'X-Agent007-Deployment-Id': deploymentIdentity.deploymentId ?? 'unknown', 'X-Agent007-Release-Commit': deploymentIdentity.releaseCommit ?? 'unknown', 'X-Agent007-Request-Id': requestId, 'X-Agent007-Release-Fingerprint': releaseAttestation.fingerprint } })
}

interface OrchestratorRunOptionsWithSignal { conversationId: string; userMessage: string; attachments: AttachmentMeta[]; language: 'en' | 'zh'; emit: OrchestratorEventEmit; signal: AbortSignal }
function stripDataUrl(a: AttachmentMeta) { return { filename: a.filename, originalName: a.originalName, mimeType: a.mimeType, size: a.size, textContent: a.textContent ? a.textContent.slice(0, 8000) : undefined } }
