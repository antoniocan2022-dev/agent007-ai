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
import { safeConversationRows } from '@/lib/ceo-behavioral-policy'
import { projectCeoPublicSsePayload } from '@/lib/ceo-public-transport'
import { filterConversationalMemories } from '@/lib/ceo-memory-visibility'
import { getAllPersistentMemory } from '@/lib/persistent-memory'
import { computeWorldStateDelta } from '@/lib/ceo-world-state'
import { generateRecommendationCorrelationId, recordCeoRecommendation } from '@/lib/ceo-outcome-learning'
import { buildConversationDecisionContract } from '@/lib/ceo-conversation-decision-contract'
import { buildCeoRuntimeMetrics, logCeoRuntimeMetrics } from '@/lib/ceo-runtime-metrics'
import { createReleaseAttestation, getReleaseIdentity, newReleaseRequestId } from '@/lib/release-attestation'
import { CeoRequestAbortedError, isCeoRequestAborted } from '@/lib/ceo-cancellation'
import { runWithCeoCancellationContext } from '@/lib/ceo-cancellation-context'
import { interpretCeoSemantics } from '@/lib/ceo-semantic-interpreter'
import { CEO_PERSONALITY_CHARTER } from '@/lib/ceo-personality'
import { sanitizeCeoErrorForUser } from '@/lib/ceo-response-composer'
import { persistCeoAssistantMessage, updateCeoAssistantMessage, recordSupersededCeoResponse, closeCeoTurnMarker, CeoResponseSupersededError } from '@/lib/ceo-response-persistence'
import { isUniqueConstraintViolation, normalizeClientRequestId } from '@/lib/ceo-turn-sequencing'
import type { AttachmentMeta } from '@/lib/tools'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 240

type DeploymentIdentity = { deploymentId: string | null; releaseCommit: string | null }
function getDeploymentIdentity(): DeploymentIdentity { return { deploymentId: process.env.VERCEL_DEPLOYMENT_ID?.trim() || null, releaseCommit: process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null } }
function sse(event: string, data: unknown): string { const identity = getDeploymentIdentity(); const payload = { ...projectCeoPublicSsePayload(event, data), deploymentId: identity.deploymentId, releaseCommit: identity.releaseCommit }; return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n` }
async function loadConversationContext(conversationId: string, userId: string): Promise<{ rows: PersistedConversationRow[]; memories: PersistedMemoryRow[] }> {
  let rows: PersistedConversationRow[] = []
  try { const conversation = await db.conversation.findFirst({ where: { id: conversationId, userId }, select: { Message: { orderBy: { createdAt: 'asc' }, select: { role: true, content: true, createdAt: true } } } }); rows = safeConversationRows((conversation?.Message ?? []).map((row) => ({ role: row.role, content: row.content, createdAt: row.createdAt }))) } catch (error) { console.warn('[api/agent] Conversation rows load failed:', error instanceof Error ? error.message.slice(0, 180) : String(error)) }
  let memories: PersistedMemoryRow[] = []
  try { memories = filterConversationalMemories(await db.memory.findMany({ orderBy: { updatedAt: 'desc' }, take: 40, select: { key: true, value: true, category: true, updatedAt: true } })) } catch (error) { console.warn('[api/agent] Direct memory query failed, falling back to file-backed store:', error instanceof Error ? error.message.slice(0, 180) : String(error)); try { const fallback = await getAllPersistentMemory(); memories = filterConversationalMemories(fallback.slice(0, 40).map((entry) => ({ key: entry.key, value: entry.value, category: entry.category, updatedAt: entry.createdAt }))) } catch (fallbackError) { console.warn('[api/agent] File-backed memory fallback also failed:', fallbackError instanceof Error ? fallbackError.message.slice(0, 180) : String(fallbackError)) } }
  return { rows, memories }
}
function buildSystemPrompt(): string { const identity = 'You are Agent007, the CEO and executive intelligence of a governed AI organization. Answer the user directly, naturally, accurately, and without claiming unperformed actions or verification.'; const personality = CEO_PERSONALITY_CHARTER; const governance = 'For self-assessment requests, evaluate readiness from governed internal organizational state; clearly distinguish known facts, inferred conclusions, current limitations, and unknowns. Do not invent live verification.'; return `${identity}\n\n${personality}\n\n${governance}` }

export async function POST(req: NextRequest) {
  await ensureDbReady().catch(() => {})
  const session = await getServerSession(authOptions)
  const sessionUserId = typeof (session?.user as { id?: unknown } | undefined)?.id === 'string' ? (session!.user as { id: string }).id : ''
  if (!sessionUserId) return new Response(JSON.stringify({ error: 'Authentication required.' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
  let body: any
  try { body = await req.json() } catch { return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } }) }
  const { message, conversationId, attachments, language, clientRequestId: rawClientRequestId } = body as { message?: string; conversationId?: string; attachments?: AttachmentMeta[]; language?: 'en' | 'zh'; clientRequestId?: string }
  if (!message || typeof message !== 'string') return new Response(JSON.stringify({ error: 'Missing \'message\'' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  if (!conversationId || typeof conversationId !== 'string') return new Response(JSON.stringify({ error: 'Missing \'conversationId\'' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  const lang: 'en' | 'zh' = language === 'zh' ? 'zh' : 'en'
  const atts: AttachmentMeta[] = Array.isArray(attachments) ? attachments : []
  const clientRequestId = normalizeClientRequestId(rawClientRequestId)
  const releaseIdentity = getReleaseIdentity()
  const deploymentIdentity: DeploymentIdentity = { deploymentId: releaseIdentity.deploymentId, releaseCommit: releaseIdentity.vercelCommitSha }
  const requestId = newReleaseRequestId(req.headers.get('x-agent007-request-id'))
  const releaseAttestation = createReleaseAttestation(releaseIdentity, requestId)
  const requestAbortController = new AbortController()
  const onRequestAbort = () => requestAbortController.abort(req.signal.reason ?? new CeoRequestAbortedError(req.signal.reason))
  if (req.signal.aborted) onRequestAbort(); else req.signal.addEventListener('abort', onRequestAbort, { once: true })
  const encoder = new TextEncoder()

  let contextData: { rows: PersistedConversationRow[]; memories: PersistedMemoryRow[] }
  let myTurnSequence = 0
  let isDuplicateRequest = false
  try {
    let conv = await db.conversation.findUnique({ where: { id: conversationId }, select: { id: true, userId: true } })
    if (conv && conv.userId !== sessionUserId) return new Response(JSON.stringify({ error: 'Conversation not found.' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    if (!conv) conv = await db.conversation.create({ data: { id: conversationId, title: message.slice(0, 50), userId: sessionUserId }, select: { id: true, userId: true } })
    contextData = await loadConversationContext(conversationId, sessionUserId)
    const convId = conv.id
    try {
      myTurnSequence = await db.$transaction(async (tx) => {
        const updatedConversation = await tx.conversation.update({ where: { id: convId }, data: { revision: { increment: 1 } }, select: { revision: true } })
        await tx.message.create({ data: { conversationId: convId, role: 'user', content: message, attachments: atts.length ? JSON.stringify(atts.map(stripDataUrl)) : null, turnSequence: updatedConversation.revision, clientRequestId, turnStatus: 'open' } })
        return updatedConversation.revision
      })
    } catch (turnError) {
      // Recommendation 2 (idempotency): a client retry carrying the same clientRequestId collides
      // on the (conversationId, clientRequestId) unique index and rolls back the whole transaction,
      // including the revision increment -- so a rejected duplicate never consumes a turn number.
      if (clientRequestId && isUniqueConstraintViolation(turnError)) isDuplicateRequest = true
      else throw turnError
    }
  } catch {
    req.signal.removeEventListener('abort', onRequestAbort)
    return new Response(JSON.stringify({ error: 'Unable to persist the conversation securely.' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
  }

  if (isDuplicateRequest) {
    req.signal.removeEventListener('abort', onRequestAbort)
    const duplicateStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(sse('duplicate', { message: 'This request was already accepted for this conversation and will not be run again.', requestId, releaseAttestation, deployment: deploymentIdentity })))
        controller.enqueue(encoder.encode(sse('done', { messageId: null, steps: 0, deployment: deploymentIdentity, requestId, releaseAttestation })))
        controller.close()
      },
    })
    return new Response(duplicateStream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } })
  }

  const safeContextRows = safeConversationRows(contextData.rows)
  let contextSeed: CeoContextComposition = composeCeoContext({ systemPrompt: buildSystemPrompt(), currentUserMessage: message, persistedMessages: safeContextRows, memories: contextData.memories })
  let semanticInterpretation: Awaited<ReturnType<typeof interpretCeoSemantics>> = { source: 'deterministic' }
  try { semanticInterpretation = await interpretCeoSemantics(contextSeed.canonicalSemanticContext, requestAbortController.signal) } catch (error) { if (isCeoRequestAborted(error)) { req.signal.removeEventListener('abort', onRequestAbort); await closeCeoTurnMarker({ conversationId, turnSequence: myTurnSequence }).catch(() => {}); return new Response(JSON.stringify({ error: 'Request cancelled.' }), { status: 499, headers: { 'Content-Type': 'application/json' } }) } }
  contextSeed = composeCeoContext({ systemPrompt: buildSystemPrompt(), currentUserMessage: message, persistedMessages: safeContextRows, memories: contextData.memories, semanticInterpretation })
  const preRoute = preRouteCeoRequest(contextSeed.messages, atts.length, contextSeed.canonicalSemanticContext)
  const resolvedPath = resolvePreRoute(preRoute)
  const executionContract = preRoute.executionContract
  const decisionContract = buildConversationDecisionContract(contextSeed.canonicalSemanticContext)
  const requestBudgetMs = Math.min(AGENT_REQUEST_BUDGET_MS, executionContract.latencyBudgetMs)

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const safeEnqueue = (value: string) => { if (closed) return; try { controller.enqueue(encoder.encode(value)) } catch { closed = true } }
      const baseEmit: OrchestratorEventEmit = async (event: string, data: any) => safeEnqueue(sse(event, data))
      const recoveryBudget = new RecoveryBudget(executionContract)
      const emit: OrchestratorEventEmit = async (event: string, data: any) => { const recoveryEvent = event === 'thought' ? recoveryEventFromMessage(data?.content) : null; if (recoveryEvent) { const decision = recoveryBudget.consume(recoveryEvent); if (!decision.allowed) throw new RecoveryBudgetExceededError(decision.count, decision.maxRecoveries, decision.reason); await baseEmit('progress', { phase: 'recovery', event: recoveryEvent, count: decision.count, maxRecoveries: decision.count + recoveryBudget.remaining }) } await baseEmit(event, data) }
      const heartbeat = setInterval(() => safeEnqueue(sse('ping', { ts: Date.now() })), 5000)
      beginInteractive()
      let streamOutcome: 'completed' | 'degraded' | 'cancelled' | 'timeout' | 'failed' = 'failed'
      try {
        if (requestAbortController.signal.aborted) throw new CeoRequestAbortedError(requestAbortController.signal.reason)
        if (executionContract.orchestrationOwner === 'ceo_lifecycle' || decisionContract.responseAction === 'clarify') {
          let externalEvidenceContext: string | undefined
          let externalEvidenceScope: 'external_web' | 'mixed' | undefined
          let externalEvidenceFreshness: { observedAt: number; maxAgeMs: number } | undefined
          let externalEvidenceBundle: EvidenceBundle | undefined
          let evidenceTrace: EvidenceTrace | undefined
          if (decisionContract.responseAction !== 'clarify' && (executionContract.evidenceClass === 'external_web' || executionContract.evidenceClass === 'mixed')) {
            evidenceTrace = startEvidenceTrace({ objective: message, profile: executionContract.evidenceProfile })
            const evidencePlan = buildExternalEvidencePlan({ objective: contextSeed.canonicalSemanticContext.meaning || message, evidenceClass: executionContract.evidenceClass, domain: executionContract.domain, operation: executionContract.operation, temporalScope: executionContract.temporalScope, evidenceProfile: executionContract.evidenceProfile })
            addEvidenceTraceEvent(evidenceTrace, 'planned', { queryCount: evidencePlan.queries.length, minimumSources: evidencePlan.minimumSources })
            safeEnqueue(sse('progress', { phase: 'evidence_acquisition', profile: evidencePlan.profile, queryCount: evidencePlan.queries.length, minimumSources: evidencePlan.minimumSources }))
            let evidenceExecution = await executeExternalEvidencePlan(evidencePlan, requestAbortController.signal)
            addEvidenceTraceEvent(evidenceTrace, 'search_completed', { attemptedQueries: evidenceExecution.attemptedQueries, successfulQueries: evidenceExecution.successfulQueries, sources: evidenceExecution.bundle.sources.length, sufficient: evidenceExecution.bundle.sufficient })
            if (!evidenceExecution.bundle.sufficient) {
              addEvidenceTraceEvent(evidenceTrace, 'recovery_started', { reason: 'Initial evidence bundle did not meet sufficiency requirements.' })
              safeEnqueue(sse('progress', { phase: 'evidence_recovery', reason: 'Initial evidence bundle was insufficient; running a separate evidence-recovery pass.' }))
              try { const recovered = await recoverExternalEvidencePlan(evidencePlan, requestAbortController.signal); addEvidenceTraceEvent(evidenceTrace, 'recovery_completed', { sources: recovered.bundle.sources.length, sufficient: recovered.bundle.sufficient, failures: recovered.failures.length }); if (recovered.bundle.sources.length > evidenceExecution.bundle.sources.length || recovered.bundle.sufficient) evidenceExecution = recovered } catch (recoveryError) { if (isCeoRequestAborted(recoveryError) || requestAbortController.signal.aborted) throw recoveryError; addEvidenceTraceEvent(evidenceTrace, 'recovery_completed', { sources: 0, sufficient: false, error: recoveryError instanceof Error ? recoveryError.message.slice(0, 200) : String(recoveryError).slice(0, 200) }) }
            }
            externalEvidenceBundle = evidenceExecution.bundle
            if (externalEvidenceBundle.sources.length > 0) { externalEvidenceContext = renderEvidenceBundleForPrompt(externalEvidenceBundle); externalEvidenceScope = externalEvidenceBundle.scope === 'mixed' ? 'mixed' : 'external_web'; externalEvidenceFreshness = externalEvidenceBundle.freshness }
            addEvidenceTraceEvent(evidenceTrace, externalEvidenceBundle.sufficient ? 'source_accepted' : 'source_rejected', { sources: externalEvidenceBundle.sources.length, sufficient: externalEvidenceBundle.sufficient })
            safeEnqueue(sse('progress', { phase: 'evidence_complete', sources: externalEvidenceBundle.sources.length, claims: externalEvidenceBundle.claims.length, sufficient: externalEvidenceBundle.sufficient, attemptedQueries: evidenceExecution.attemptedQueries, successfulQueries: evidenceExecution.successfulQueries, pageReads: evidenceExecution.pageReads, secSources: evidenceExecution.secSources, failures: evidenceExecution.failures.slice(0, 5) }))
          }
          const contextModules = buildCeoContextModules({ intent: executionContract.intent, missionRelevant: preRoute.missionRelevant, evidenceClass: executionContract.evidenceClass, taskClass: preRoute.taskClass, executionRequirement: executionContract.executionRequirement, evidence: externalEvidenceContext })
          const composed = composeCeoContext({ systemPrompt: buildSystemPrompt(), currentUserMessage: message, persistedMessages: safeContextRows, memories: contextData.memories, modules: contextModules, semanticInterpretation })
          const response = await runWithCeoCancellationContext(requestAbortController.signal, () => runCeoCognitiveLifecycle({ attachmentsCount: atts.length, messages: composed.messages, taskType: preRoute.taskClass, verification: 'standard', timeoutMs: executionContract.latencyBudgetMs, contextualEvidence: externalEvidenceContext, evidenceScope: externalEvidenceScope, evidenceFreshness: externalEvidenceFreshness, evidenceBundle: externalEvidenceBundle, priorConversation: safeContextRows, relevantOlderConversation: safeContextRows, preRoute, decisionContract, canonicalContext: contextSeed.canonicalSemanticContext }))
          if (externalEvidenceBundle && externalEvidenceBundle.sources.length > 0) { const claimVerification = verifyClaimEvidence(response.content, externalEvidenceBundle); addEvidenceTraceEvent(evidenceTrace!, 'gate_evaluated', { passed: claimVerification.passed, requiredClaims: claimVerification.requiredClaimCount, supportedClaims: claimVerification.supportedClaimCount, enforcedByQualityGate: true }); }
          const finalTraceState = response.degraded ? (externalEvidenceBundle?.sources.length ? 'PARTIAL' : 'ABSTAIN') : 'FULL'
          if (evidenceTrace && !evidenceTrace.completedAt) { addEvidenceTraceEvent(evidenceTrace, response.degraded ? 'abstained' : 'completed', { finalState: finalTraceState }); completeEvidenceTrace(evidenceTrace, finalTraceState) }
          const metrics = buildCeoRuntimeMetrics({ result: response, decisionContract })
          logCeoRuntimeMetrics(metrics, requestId)
          // Recommendation 2 (optimistic revision-sequencing): the staleness check and the write happen
          // inside one transaction (persistCeoAssistantMessage), not as a separate read followed by a
          // conditional write -- that would leave a race window for a newer turn to land in between the
          // two. If a newer user turn was accepted before the write commits, the transaction throws
          // CeoResponseSupersededError and nothing is written; the response is audited but never added
          // to the visible transcript or broadcast as the current answer.
          let persistedAssistantMessageId: string | null = null
          let responseSuperseded = false
          const provenance = response.quality.finalResponseProvenance
          if (provenance) {
            try { persistedAssistantMessageId = await persistCeoAssistantMessage({ conversationId, content: response.content, provenance, capturedTurnSequence: myTurnSequence }) } catch (persistErr: any) {
              if (persistErr instanceof CeoResponseSupersededError) { responseSuperseded = true; await recordSupersededCeoResponse({ conversationId, content: response.content, capturedTurnSequence: myTurnSequence, latestRevision: persistErr.latestRevision }).catch((auditErr) => console.warn('[api/agent] Superseded-response audit logging failed:', auditErr instanceof Error ? auditErr.message.slice(0, 150) : String(auditErr))) }
              else { console.warn('[api/agent] CEO-lane assistant persistence failed:', persistErr?.message?.slice(0, 150)); throw persistErr }
            }
          } else throw new Error('CEO_RESPONSE_PERSISTENCE_PROVENANCE_MISSING')
          if (!responseSuperseded && !response.degraded) {
            try { const afterRows = [...safeContextRows, { role: 'user' as const, content: message, createdAt: Date.now() }, { role: 'assistant' as const, content: response.content, createdAt: Date.now() }]; const delta = computeWorldStateDelta(safeContextRows, afterRows, message); if (delta.newDecisions.length || delta.newGoals.length || delta.newCommitments.length || delta.newOpenLoops.length || delta.resolvedOpenLoops.length || delta.newCorrections.length || delta.newlySuperseded.length) console.log('[ceo-world-state-delta]', JSON.stringify({ requestId, newDecisions: delta.newDecisions.length, newGoals: delta.newGoals.length, newCommitments: delta.newCommitments.length, newOpenLoops: delta.newOpenLoops.length, resolvedOpenLoops: delta.resolvedOpenLoops.length, newCorrections: delta.newCorrections.length, newlySuperseded: delta.newlySuperseded.length })) } catch (deltaError) { console.warn('[api/agent] World-state delta computation failed (non-critical):', deltaError instanceof Error ? deltaError.message.slice(0, 150) : String(deltaError)) }
          }
          if (!responseSuperseded && (decisionContract?.responseAction === 'recommend' || decisionContract?.responseAction === 'decide')) { const correlationId = generateRecommendationCorrelationId(); recordCeoRecommendation({ correlationId, objective: message, responseAction: decisionContract.responseAction, recommendedAction: response.content, decisionRationale: decisionContract.rationale.join('; ') }).catch((error) => console.warn('[api/agent] Recommendation outcome capture failed:', error instanceof Error ? error.message.slice(0, 180) : String(error))) }
          streamOutcome = responseSuperseded ? 'degraded' : (response.degraded ? 'degraded' : 'completed')
          console.log('[ceo-request-trace]', JSON.stringify({ requestId, endpoint: '/api/agent', deploymentId: releaseAttestation.deploymentId, executedCommitSha: releaseAttestation.executedCommitSha, fingerprint: releaseAttestation.fingerprint, outcome: streamOutcome, executionPath: response.decisionPlan.path, provider: response.provider, model: response.model, superseded: responseSuperseded }))
          if (responseSuperseded) {
            safeEnqueue(sse('superseded', { reason: 'A newer message in this conversation was already accepted before this response finished computing, so it was not added to the conversation.', deployment: deploymentIdentity, requestId, releaseAttestation }))
            safeEnqueue(sse('done', { messageId: null, steps: 0, executionClass: response.decisionPlan.path, deployment: deploymentIdentity, requestId, releaseAttestation, decisionContract, executionContract }))
          } else {
            safeEnqueue(sse('answer', { content: response.content, provider: response.provider, model: response.model, executionClass: response.decisionPlan.path, evidenceState: response.evidenceState, quality: response.quality, cognitiveMetrics: metrics, responseMs: response.responseMs, deployment: deploymentIdentity, requestId, releaseAttestation, decisionContract, executionContract, evidenceTrace, context: { recentMessages: contextSeed.recentMessages, relevantOlderMessages: contextSeed.relevantOlderMessages, summarizedOlderMessages: contextSeed.summarizedOlderMessages, selectedMemoryKeys: contextSeed.selectedMemoryKeys, modules: composed.modules } }))
            safeEnqueue(sse('done', { messageId: persistedAssistantMessageId, steps: executionContract.evidenceClass === 'external_web' ? 2 : 1, executionClass: response.decisionPlan.path, provider: response.provider, model: response.model, evidenceState: response.evidenceState, deployment: deploymentIdentity, requestId, releaseAttestation, cognitiveMetrics: metrics, decisionContract, executionContract }))
          }
        } else {
          const operationalModules = buildCeoContextModules({ intent: executionContract.intent, missionRelevant: preRoute.missionRelevant, evidenceClass: executionContract.evidenceClass, taskClass: preRoute.taskClass, executionRequirement: executionContract.executionRequirement })
          const baseOperationalContext = composeCeoContext({ systemPrompt: buildSystemPrompt(), currentUserMessage: message, persistedMessages: safeContextRows, memories: contextData.memories, modules: operationalModules, semanticInterpretation })
          const result = await withOrchestrationOwner('operational_orchestrator', () => runWithAgentRequestBudget((signal) => runOrchestrator({ conversationId, userMessage: message, attachments: atts, language: lang, emit, signal } as OrchestratorRunOptionsWithSignal), requestBudgetMs, requestAbortController.signal))
          const operationalEvidence = result.finalAnswer.slice(0, 24000)
          console.log('[api/agent] operational execution telemetry', JSON.stringify({ requestId, completedSteps: result.steps.length, toolSteps: result.steps.filter((step) => Boolean(step.toolName)).length }))
          const synthesisModules = buildCeoContextModules({ intent: executionContract.intent, missionRelevant: preRoute.missionRelevant, evidenceClass: executionContract.evidenceClass, taskClass: preRoute.taskClass, executionRequirement: executionContract.executionRequirement, execution: operationalEvidence })
          const composedOperational = composeCeoContext({ systemPrompt: buildSystemPrompt(), currentUserMessage: message, persistedMessages: safeContextRows, memories: contextData.memories, modules: synthesisModules, semanticInterpretation })
          const synthesis = await runWithCeoCancellationContext(requestAbortController.signal, () => runCeoCognitiveLifecycle({ attachmentsCount: atts.length, messages: composedOperational.messages, taskType: preRoute.taskClass, verification: 'standard', timeoutMs: Math.min(60000, requestBudgetMs), contextualEvidence: operationalEvidence, evidenceScope: 'internal_state', evidenceFreshness: { observedAt: Date.now(), maxAgeMs: 300000 }, priorConversation: safeContextRows, relevantOlderConversation: safeContextRows, preRoute, decisionContract, canonicalContext: composedOperational.canonicalSemanticContext }))
          const metrics = buildCeoRuntimeMetrics({ result: synthesis, decisionContract })
          logCeoRuntimeMetrics(metrics, requestId)
          const persistedAssistantMessageId = result.persistedAssistantMessageId
          // Recommendation 2 (optimistic revision-sequencing): the orchestrator's real actions already
          // ran by this point (that is not undone -- cooperative cancellation mid-execution is out of
          // scope here), but the CEO synthesis text that reports on them can still be stale if a newer
          // user turn arrived while it was being generated. The staleness check and the write happen
          // inside one transaction (updateCeoAssistantMessage), closing the race window a separate
          // read-then-write would leave open. A stale synthesis is never written over the orchestrator's
          // own record of what it did, and is never broadcast as the current answer.
          let responseSuperseded = false
          const synthesisProvenance = synthesis.quality.finalResponseProvenance
          if (synthesisProvenance) {
            try { await updateCeoAssistantMessage({ messageId: result.persistedAssistantMessageId, content: synthesis.content, provenance: synthesisProvenance, capturedTurnSequence: myTurnSequence, conversationId }) } catch (persistErr: any) {
              if (persistErr instanceof CeoResponseSupersededError) { responseSuperseded = true; await recordSupersededCeoResponse({ conversationId, content: synthesis.content, capturedTurnSequence: myTurnSequence, latestRevision: persistErr.latestRevision }).catch((auditErr) => console.warn('[api/agent] Superseded-synthesis audit logging failed:', auditErr instanceof Error ? auditErr.message.slice(0, 150) : String(auditErr))) }
              else { console.warn('[api/agent] Operational synthesis history update failed:', persistErr?.message?.slice(0, 150)); throw persistErr }
            }
          } else throw new Error('CEO_RESPONSE_PERSISTENCE_PROVENANCE_MISSING')
          streamOutcome = responseSuperseded ? 'degraded' : (synthesis.degraded ? 'degraded' : 'completed')
          console.log('[ceo-request-trace]', JSON.stringify({ requestId, endpoint: '/api/agent', deploymentId: releaseAttestation.deploymentId, executedCommitSha: releaseAttestation.executedCommitSha, fingerprint: releaseAttestation.fingerprint, outcome: streamOutcome, executionPath: synthesis.decisionPlan.path, provider: synthesis.provider, model: synthesis.model, superseded: responseSuperseded }))
          if (responseSuperseded) {
            safeEnqueue(sse('superseded', { reason: 'A newer message in this conversation was already accepted before the executive synthesis finished computing, so it was not written as the current answer.', deployment: deploymentIdentity, requestId, releaseAttestation }))
            safeEnqueue(sse('done', { messageId: persistedAssistantMessageId, steps: result.steps.length, executionClass: synthesis.decisionPlan.path, deployment: deploymentIdentity, requestId, releaseAttestation, decisionContract, executionContract, recoveryCount: recoveryBudget.used }))
          } else {
            safeEnqueue(sse('answer', { content: synthesis.content, provider: synthesis.provider, model: synthesis.model, executionClass: synthesis.decisionPlan.path, evidenceState: synthesis.evidenceState, quality: synthesis.quality, cognitiveMetrics: metrics, responseMs: synthesis.responseMs, deployment: deploymentIdentity, requestId, releaseAttestation, decisionContract, executionContract, operationalSteps: result.steps.length, context: { recentMessages: baseOperationalContext.recentMessages, relevantOlderMessages: baseOperationalContext.relevantOlderMessages, summarizedOlderMessages: baseOperationalContext.summarizedOlderMessages, selectedMemoryKeys: baseOperationalContext.selectedMemoryKeys, modules: composedOperational.modules } }))
            safeEnqueue(sse('done', { messageId: persistedAssistantMessageId, steps: result.steps.length + 1, executionClass: synthesis.decisionPlan.path, provider: synthesis.provider, model: synthesis.model, evidenceState: synthesis.evidenceState, deployment: deploymentIdentity, requestId, releaseAttestation, cognitiveMetrics: metrics, decisionContract, executionContract, recoveryCount: recoveryBudget.used }))
          }
        }
      } catch (e: any) {
        const cancelled = isCeoRequestAborted(e) || requestAbortController.signal.aborted
        if (cancelled) { streamOutcome = 'cancelled'; console.log('[ceo-request-trace]', JSON.stringify({ requestId, endpoint: '/api/agent', deploymentId: releaseAttestation.deploymentId, executedCommitSha: releaseAttestation.executedCommitSha, fingerprint: releaseAttestation.fingerprint, outcome: 'cancelled' })); await baseEmit('error', { message: 'Agent007 stopped the request because it was cancelled. No assistant response was committed after cancellation.', executionClass: resolvedPath, code: 'CEO_REQUEST_ABORTED', retryable: true, requestId, releaseAttestation, deployment: deploymentIdentity }) }
        else if (e instanceof RecoveryBudgetExceededError || e?.code === 'CEO_RECOVERY_BUDGET_EXCEEDED') { streamOutcome = 'failed'; await baseEmit('error', { message: 'Agent007 stopped this request after exhausting its governed recovery budget. The request state remains safe; retry is available.', executionClass: resolvedPath, code: 'CEO_RECOVERY_BUDGET_EXCEEDED', recoveryCount: recoveryBudget.used, maxRecoveries: recoveryBudget.remaining + recoveryBudget.used, retryable: true, requestId, releaseAttestation, deployment: deploymentIdentity }) }
        else if (e instanceof AgentRequestTimeoutError || e?.code === 'AGENT_REQUEST_TIMEOUT') { streamOutcome = 'timeout'; console.log('[ceo-request-trace]', JSON.stringify({ requestId, endpoint: '/api/agent', deploymentId: releaseAttestation.deploymentId, executedCommitSha: releaseAttestation.executedCommitSha, fingerprint: releaseAttestation.fingerprint, outcome: 'timeout' })); await baseEmit('error', { message: 'Agent007 stopped this request before the execution budget so it can remain responsive. The work already persisted is safe; retry to continue from the durable state.', executionClass: resolvedPath, code: 'AGENT_REQUEST_TIMEOUT', timeoutMs: requestBudgetMs, retryable: true, requestId, releaseAttestation, deployment: deploymentIdentity }) }
        else { streamOutcome = 'failed'; console.log('[ceo-request-trace]', JSON.stringify({ requestId, endpoint: '/api/agent', deploymentId: releaseAttestation.deploymentId, executedCommitSha: releaseAttestation.executedCommitSha, fingerprint: releaseAttestation.fingerprint, outcome: 'failed', errorClass: e instanceof Error ? e.name : typeof e })); await baseEmit('error', { message: sanitizeCeoErrorForUser(e), executionClass: resolvedPath, requestId, releaseAttestation, deployment: deploymentIdentity }) }
      } finally { clearInterval(heartbeat); endInteractive(); req.signal.removeEventListener('abort', onRequestAbort); await closeCeoTurnMarker({ conversationId, turnSequence: myTurnSequence }).catch((markerErr) => console.warn('[api/agent] Turn-marker close failed:', markerErr instanceof Error ? markerErr.message.slice(0, 150) : String(markerErr))); try { controller.close() } catch {} closed = true; if (streamOutcome !== 'completed' && streamOutcome !== 'degraded') console.log('[ceo-request-outcome]', JSON.stringify({ requestId, outcome: streamOutcome })) }
    },
    cancel(reason) { requestAbortController.abort(reason ?? new CeoRequestAbortedError(reason)) },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'X-Agent007-Deployment-Id': deploymentIdentity.deploymentId ?? 'unknown', 'X-Agent007-Release-Commit': deploymentIdentity.releaseCommit ?? 'unknown', 'X-Agent007-Request-Id': requestId, 'X-Agent007-Release-Fingerprint': releaseAttestation.fingerprint } })
}
interface OrchestratorRunOptionsWithSignal { conversationId: string; userMessage: string; attachments: AttachmentMeta[]; language: 'en' | 'zh'; emit: OrchestratorEventEmit; signal: AbortSignal }
function stripDataUrl(a: AttachmentMeta) { return { filename: a.filename, originalName: a.originalName, mimeType: a.mimeType, size: a.size, textContent: a.textContent ? a.textContent.slice(0, 8000) : undefined } }
