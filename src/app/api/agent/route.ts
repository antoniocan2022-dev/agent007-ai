import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { db, ensureDbReady } from '@/lib/db'
import { authOptions } from '@/lib/auth'
import { runOrchestrator, type OrchestratorEventEmit } from '@/lib/orchestrator'
import { attachmentContextSuffix } from '@/lib/agent'
import { beginInteractive, endInteractive } from '@/lib/load-tracker'
import { runCeoCognitiveLifecycle } from '@/lib/ceo-cognitive-lifecycle'
import { buildCeoTurnDecision } from '@/lib/ceo-turn-decision'
import { preRouteCeoRequest, resolvePreRoute } from '@/lib/ceo-pre-router'
import { withOrchestrationOwner } from '@/lib/ceo-execution-owner'
import { RecoveryBudget, RecoveryBudgetExceededError, recoveryEventFromMessage } from '@/lib/ceo-recovery-policy'
import { AgentRequestTimeoutError, AGENT_REQUEST_BUDGET_MS, runWithAgentRequestBudget } from '@/lib/agent-request-budget'
import { buildExternalEvidencePlan } from '@/lib/ceo-evidence-planner'
import { getSecTickerMap, resolveEquityIssuers } from '@/lib/ceo-issuer-resolution'
import { executeExternalEvidencePlan, recoverExternalEvidencePlan } from '@/lib/ceo-evidence-executor'
import { renderEvidenceBundleForPrompt, type EvidenceBundle } from '@/lib/ceo-evidence-bundle'
import { verifyClaimEvidence } from '@/lib/ceo-claim-evidence-gate'
import { addEvidenceTraceEvent, completeEvidenceTrace, startEvidenceTrace, type EvidenceTrace } from '@/lib/ceo-evidence-trace'
import { buildCeoContextModules, composeCeoContext, type PersistedConversationRow, type PersistedMemoryRow, type CeoContextComposition } from '@/lib/ceo-context-composer'
import { persistEpisodicDecisionMemory } from '@/lib/ceo-episodic-memory-writer'
import { safeConversationRows } from '@/lib/ceo-behavioral-policy'
import { projectCeoPublicSsePayload, resolveCeoPublicSseEvent } from '@/lib/ceo-public-transport'
import { filterConversationalMemories } from '@/lib/ceo-memory-visibility'
import { getAllPersistentMemory } from '@/lib/persistent-memory'
import { computeWorldStateDelta } from '@/lib/ceo-world-state'
import { deriveCeoConversationState } from '@/lib/ceo-conversation-state'
import { generateRecommendationCorrelationId, recordCeoRecommendation } from '@/lib/ceo-outcome-learning'
import { buildCeoRuntimeMetrics, logCeoRuntimeMetrics } from '@/lib/ceo-runtime-metrics'
import { createReleaseAttestation, getReleaseIdentity, newReleaseRequestId } from '@/lib/release-attestation'
import { CeoRequestAbortedError, isCeoRequestAborted } from '@/lib/ceo-cancellation'
import { runWithCeoCancellationContext } from '@/lib/ceo-cancellation-context'
import { interpretCeoSemantics } from '@/lib/ceo-semantic-interpreter'
import { getPartnerIntelligence, type PartnerIntelligenceSummary } from '@/lib/ceo-partner-intelligence'
import { getExecutiveBusinessState, type ExecutiveBusinessState } from '@/lib/ceo-executive-state'
import { getLeadershipPerformanceLedger, type LeaderPerformanceRecord } from '@/lib/ceo-leadership-performance'
import { getStrategicHorizonView, type StrategicHorizonView } from '@/lib/ceo-strategic-horizon'
import { assessCeoSelfInspection, gatherCeoSelfInspectionEvidence, renderCeoSelfInspectionContext } from '@/lib/ceo-self-inspection'
import { searchKnowledgeBase, formatKbContext } from '@/lib/knowledge-base'
import { renderCeoCapabilityBriefing } from '@/lib/ceo-capability-briefing'
import { listActiveMissionsDB } from '@/lib/active-missions-db'
import { resolveVentureId } from '@/lib/ceo-venture-state'
import { buildCeoSystemPrompt } from '@/lib/ceo-system-prompt'
import { sanitizeCeoErrorForUser } from '@/lib/ceo-response-composer'
import { persistCeoAssistantMessage, recordSupersededCeoResponse, closeCeoTurnMarker, CeoResponseSupersededError } from '@/lib/ceo-response-persistence'
import { notifyMissionOutcome } from '@/lib/mission-notifications'
import { isUniqueConstraintViolation, normalizeClientRequestId } from '@/lib/ceo-turn-sequencing'
import type { AttachmentMeta } from '@/lib/tools'
import { classifyOperationalExecution } from '@/lib/ceo-execution-handoff'
import { ensureResearchObjective, loadActiveResearchObjective, researchObjectiveFromPreRoute, shouldContinueResearchObjective, type ResearchObjectiveIdentity } from '@/lib/ceo-research-objective'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 240

type DeploymentIdentity = { deploymentId: string | null; releaseCommit: string | null }
function getDeploymentIdentity(): DeploymentIdentity { return { deploymentId: process.env.VERCEL_DEPLOYMENT_ID?.trim() || null, releaseCommit: process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null } }

async function persistPostResponseDecisionMemory(input: { conversationRows: readonly PersistedConversationRow[]; userMessage: string; assistantMessage: string }): Promise<void> {
  const state = deriveCeoConversationState([
    ...input.conversationRows,
    { role: 'user', content: input.userMessage, createdAt: Date.now() },
    { role: 'assistant', content: input.assistantMessage, createdAt: Date.now() },
  ], input.userMessage)
  await persistEpisodicDecisionMemory(state)
}
function sse(event: string, data: unknown): string { const identity = getDeploymentIdentity(); const publicEvent = resolveCeoPublicSseEvent(event); const payload = { ...projectCeoPublicSsePayload(event, data), deploymentId: identity.deploymentId, releaseCommit: identity.releaseCommit }; return `event: ${publicEvent}\ndata: ${JSON.stringify(payload)}\n\n` }
async function loadConversationContext(conversationId: string, userId: string): Promise<{ rows: PersistedConversationRow[]; memories: PersistedMemoryRow[] }> {
  let rows: PersistedConversationRow[] = []
  try { const conversation = await db.conversation.findFirst({ where: { id: conversationId, userId }, select: { Message: { orderBy: { createdAt: 'asc' }, select: { role: true, content: true, createdAt: true } } } }); rows = safeConversationRows((conversation?.Message ?? []).map((row) => ({ role: row.role, content: row.content, createdAt: row.createdAt }))) } catch (error) { console.warn('[api/agent] Conversation rows load failed:', error instanceof Error ? error.message.slice(0, 180) : String(error)) }
  let memories: PersistedMemoryRow[] = []
  try { memories = filterConversationalMemories(await db.memory.findMany({ orderBy: { updatedAt: 'desc' }, take: 40, select: { key: true, value: true, category: true, updatedAt: true } })) } catch (error) { console.warn('[api/agent] Direct memory query failed, falling back to file-backed store:', error instanceof Error ? error.message.slice(0, 180) : String(error)); try { const fallback = await getAllPersistentMemory(); memories = filterConversationalMemories(fallback.slice(0, 40).map((entry) => ({ key: entry.key, value: entry.value, category: entry.category, updatedAt: entry.createdAt }))) } catch (fallbackError) { console.warn('[api/agent] File-backed memory fallback also failed:', fallbackError instanceof Error ? fallbackError.message.slice(0, 180) : String(fallbackError)) } }
  return { rows, memories }
}


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
  let activeResearchObjective: ResearchObjectiveIdentity | null = null
  let myTurnSequence = 0
  let isDuplicateRequest = false
  try {
    let conv = await db.conversation.findUnique({ where: { id: conversationId }, select: { id: true, userId: true } })
    if (conv && conv.userId !== sessionUserId) return new Response(JSON.stringify({ error: 'Conversation not found.' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    if (!conv) conv = await db.conversation.create({ data: { id: conversationId, title: message.slice(0, 50), userId: sessionUserId }, select: { id: true, userId: true } })
    contextData = await loadConversationContext(conversationId, sessionUserId)
    activeResearchObjective = await loadActiveResearchObjective({ conversationId, userId: sessionUserId })
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
  let contextSeed: CeoContextComposition = await composeCeoContext({ systemPrompt: buildCeoSystemPrompt(), currentUserMessage: message, persistedMessages: safeContextRows, memories: contextData.memories, researchObjective: activeResearchObjective ?? undefined, signal: requestAbortController.signal })
  let semanticInterpretation: Awaited<ReturnType<typeof interpretCeoSemantics>> = { source: 'deterministic' }
  try { semanticInterpretation = await interpretCeoSemantics(contextSeed.canonicalSemanticContext, requestAbortController.signal) } catch (error) { if (isCeoRequestAborted(error)) { req.signal.removeEventListener('abort', onRequestAbort); await closeCeoTurnMarker({ conversationId, turnSequence: myTurnSequence }).catch(() => {}); return new Response(JSON.stringify({ error: 'Request cancelled.' }), { status: 499, headers: { 'Content-Type': 'application/json' } }) } }
  contextSeed = await composeCeoContext({ systemPrompt: buildCeoSystemPrompt(), currentUserMessage: message, persistedMessages: safeContextRows, memories: contextData.memories, researchObjective: activeResearchObjective ?? undefined, semanticInterpretation, reuseSemanticContext: { selectedMemories: contextSeed.selectedMemories, semanticMemoryKeys: contextSeed.semanticMemoryKeys }, signal: requestAbortController.signal })
  // Best-effort: makes this conversation's current decisions durable across future conversations via
  // the existing Memory-backed lexical/semantic retrieval path. Never allowed to affect the response.
  await persistEpisodicDecisionMemory(contextSeed.conversationState).catch(() => {})
  // Stage 2 of the CEO Conversation Kernel migration (2026-09-18): decisionContract is now built exactly
  // once, inside composeCeoContext, from this same canonicalSemanticContext -- read it here instead of
  // rebuilding it, and pass it into preRouteCeoRequest so its own internal build (previously a second,
  // byte-identical copy used only for curiosity/evidence narrowing then discarded) is skipped too.
  let decisionContract = contextSeed.decisionContract
  let preRoute = preRouteCeoRequest(contextSeed.messages, atts.length, contextSeed.canonicalSemanticContext, decisionContract)
  // Establish/continue the durable objective before the single turn decision is built. This is the
  // boundary that converts a transiently inferred equity task into an authoritative identity that all
  // downstream stages can carry, while preserving the exact current utterance as the response surface.
  const objectiveCandidate = researchObjectiveFromPreRoute(preRoute, message)
  if (objectiveCandidate) {
    const continuing = Boolean(activeResearchObjective && shouldContinueResearchObjective(message, activeResearchObjective))
    const lifecycleState = continuing
      ? (contextSeed.canonicalSemanticContext.speechAct === 'correction' ? 'CORRECTED' : 'CONTINUED')
      : 'ESTABLISHED'
    const ensuredObjective = await ensureResearchObjective({
      conversationId,
      userId: sessionUserId,
      turnSequence: myTurnSequence,
      candidate: objectiveCandidate,
      continuation: continuing,
      lifecycleState,
      reason: continuing ? 'Natural cross-turn continuation of the active public-equity research objective.' : 'Public-equity research objective established from the current turn.',
    })
    if (ensuredObjective) {
      activeResearchObjective = ensuredObjective
      preRoute = {
        ...preRoute,
        researchObjective: ensuredObjective,
        routingObjective: ensuredObjective.currentObjective || ensuredObjective.objectiveAnchor,
        executionContract: { ...preRoute.executionContract, researchObjective: ensuredObjective },
      }
      decisionContract = { ...decisionContract, researchObjective: ensuredObjective }
      // The objective was established after the first canonical context snapshot. Patch that snapshot
      // in place rather than recomputing semantics/embeddings: every remaining stage now sees the same
      // authoritative identity without reintroducing duplicate decision construction.
      contextSeed = {
        ...contextSeed,
        canonicalSemanticContext: { ...contextSeed.canonicalSemanticContext, researchObjective: ensuredObjective },
        researchObjective: ensuredObjective,
      }
    }
  }
  const resolvedPath = resolvePreRoute(preRoute)
  const executionContract = preRoute.executionContract
  // Phase 2 of the CEO Conversation Kernel migration (external audit, 2026-09-19), issues 1 and 8: the
  // single "DECIDE" authority for this turn -- built exactly once, here, from the same preRoute and
  // decisionContract every downstream consumer already uses. turnDecision.decisionPlan is threaded into
  // every runCeoCognitiveLifecycle call below instead of letting each one
  // build its own, so buildCeoDecisionPlan runs at most once per turn by construction, not merely
  // because Stage 1b's branching happens to make those call sites mutually exclusive.
  const turnDecision = buildCeoTurnDecision({ messages: contextSeed.messages, preRoute, missionId: undefined, taskType: preRoute.taskClass, decisionContract })
  const requestBudgetMs = Math.min(AGENT_REQUEST_BUDGET_MS, executionContract.latencyBudgetMs)
  // CEO Grounding Policy: retrieve the minimum sufficient live context, not everything on every
  // turn. getExecutiveBusinessState is backed by calculateOperationalKpis, which does real DB scans
  // and transaction-verification work, so it stays gated -- but the gate used to be self_assessment
  // only, which meant ceo-decision-synthesis.ts's cross-domain judgment (fed by exactly these three
  // inputs) never received real data on the decision/recommendation/mission turns it exists for.
  // Widened to the turns that actually consume this state: self-assessment (unchanged), analysis/
  // decision intent, a recommend/decide response action, and mission-relevant turns. Ordinary
  // conversation still fetches none of this.
  const selfInspection = assessCeoSelfInspection(contextSeed.canonicalSemanticContext, decisionContract)
  const groundingWarranted = executionContract.intent === 'self_assessment'
    || executionContract.intent === 'analysis'
    || executionContract.intent === 'decision'
    || decisionContract.responseAction === 'recommend'
    || decisionContract.responseAction === 'decide'
    || preRoute.missionRelevant
    || selfInspection.inspect
  let executiveState: ExecutiveBusinessState | undefined
  let leadershipLedger: readonly LeaderPerformanceRecord[] | undefined
  let strategicHorizon: StrategicHorizonView | undefined
  // Deep-audit fix (2026-09-13): partnerIntelligence used to be fetched unconditionally on every turn
  // (a real db.partnership.findMany scan) and unconditionally injected into every prompt via
  // ceo-cognitive-lifecycle.ts's worldModelMessages, directly contradicting the "minimum sufficient
  // live context, not everything on every turn" policy this same gate exists to enforce for its
  // sibling calls -- a plain "hi, how's it going" burned a DB scan and got partner-relationship data
  // injected into its prompt for no reason. Now gated behind the same groundingWarranted flag.
  let partnerIntelligence: PartnerIntelligenceSummary | undefined
  // Only populated (and only then passed to buildCeoContextModules below) when self-inspection
  // actually has something to report -- like the evidence/mission/execution modules, an irrelevant
  // turn gets no self-inspection system message at all, not an honest-but-noisy "not evaluated" one.
  let selfInspectionContext: string | undefined
  if (groundingWarranted) {
    const ventureId = resolveVentureId(message)
    const sharedMissions = await listActiveMissionsDB(sessionUserId).catch(() => undefined)
    const [groundingState, groundingLeadership, groundingHorizon, selfInspectionEvidence, groundingPartnerIntelligence] = await Promise.all([
      getExecutiveBusinessState({ userId: sessionUserId, ventureId }).catch(() => undefined),
      getLeadershipPerformanceLedger(sessionUserId, sharedMissions).catch(() => undefined),
      getStrategicHorizonView(sessionUserId, new Date(), sharedMissions).catch(() => undefined),
      selfInspection.inspect ? gatherCeoSelfInspectionEvidence({ ventureId, missionIds: sharedMissions?.map((mission) => mission.id) }) : Promise.resolve(undefined),
      getPartnerIntelligence(sessionUserId).catch(() => undefined),
    ])
    executiveState = groundingState
    leadershipLedger = groundingLeadership
    strategicHorizon = groundingHorizon
    partnerIntelligence = groundingPartnerIntelligence
    if (selfInspectionEvidence) selfInspectionContext = renderCeoSelfInspectionContext(selfInspectionEvidence)
  }

  // Best-effort: surfaces relevant chunks from documents the user has ingested into their knowledge
  // base (see document-ingestion.ts / /api/kb). Runs every turn like memory retrieval, not gated
  // behind groundingWarranted -- it's a single bounded, indexed query that fails closed to an empty
  // module rather than an error, and a user referencing something they uploaded shouldn't require an
  // explicit self-assessment/decision turn to surface it.
  const knowledgeResults = await searchKnowledgeBase(sessionUserId, message, 4).catch(() => [])
  const knowledgeContext = knowledgeResults.length ? formatKbContext(knowledgeResults) : undefined

  // Only when the turn is specifically a capability/strengths/limitations question (the self-
  // reflection classifier's existing 'capability_assessment' kind -- see ceo-self-reflection.ts) --
  // an ordinary turn gets no capability-briefing system message at all, same discipline as every
  // other conditional module here.
  const capabilityBriefingContext = executionContract.selfReflectionKind === 'capability_assessment' ? renderCeoCapabilityBriefing() : undefined

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
            evidenceTrace = startEvidenceTrace({ objective: activeResearchObjective?.currentObjective || preRoute.routingObjective || message, profile: executionContract.evidenceProfile, requestId, objectiveId: activeResearchObjective?.id, objectiveVersion: activeResearchObjective?.version, tickers: activeResearchObjective?.tickers })
            const evidenceObjective = activeResearchObjective?.currentObjective || preRoute.routingObjective || contextSeed.canonicalSemanticContext.meaning || message
            // Deep-audit fix (P0, 2026-09-13): resolves company names (not just already-ticker-shaped
            // tokens) against SEC's real registry before planning -- see ceo-issuer-resolution.ts's own
            // comment for the full rationale. Best-effort: buildExternalEvidencePlan already treats
            // resolvedIssuers as optional and falls back to its existing raw-ticker-harvest behavior, so
            // a SEC ticker-map fetch failure here (rate limit, transient network error) degrades
            // gracefully to today's behavior rather than failing the whole turn over a resolution step
            // that only ever adds coverage, never removes it.
            const resolvedIssuers = executionContract.domain === 'public_equity' && executionContract.evidenceProfile === 'public_equity'
              ? await getSecTickerMap(requestAbortController.signal).then((tickerMap) => resolveEquityIssuers(evidenceObjective, tickerMap)).catch((error) => { if (isCeoRequestAborted(error)) throw error; return undefined })
              : undefined
            const evidencePlan = buildExternalEvidencePlan({ objective: evidenceObjective, evidenceClass: executionContract.evidenceClass, domain: executionContract.domain, operation: executionContract.operation, temporalScope: executionContract.temporalScope, evidenceProfile: executionContract.evidenceProfile, resolvedIssuers, researchObjective: activeResearchObjective ?? undefined })
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
            safeEnqueue(sse('progress', { phase: 'evidence_complete', sources: externalEvidenceBundle.sources.length, claims: externalEvidenceBundle.claims.length, sufficient: externalEvidenceBundle.sufficient, attemptedQueries: evidenceExecution.attemptedQueries, successfulQueries: evidenceExecution.successfulQueries, pageReads: evidenceExecution.pageReads, secSources: evidenceExecution.secSources, marketDataSources: evidenceExecution.marketDataSources, failures: evidenceExecution.failures.slice(0, 5) }))
          }
          const contextModules = buildCeoContextModules({ intent: executionContract.intent, missionRelevant: preRoute.missionRelevant, evidenceClass: executionContract.evidenceClass, taskClass: preRoute.taskClass, executionRequirement: executionContract.executionRequirement, evidence: externalEvidenceContext, attachments: atts.length ? attachmentContextSuffix(atts) : undefined, selfInspection: selfInspectionContext, knowledge: knowledgeContext, capabilityBriefing: capabilityBriefingContext })
          const composed = await composeCeoContext({ systemPrompt: buildCeoSystemPrompt(), currentUserMessage: message, persistedMessages: safeContextRows, memories: contextData.memories, researchObjective: activeResearchObjective ?? undefined, modules: contextModules, semanticInterpretation, reuseSemanticContext: { conversationState: contextSeed.conversationState, canonicalSemanticContext: contextSeed.canonicalSemanticContext, decisionContract, resolvedReferences: contextSeed.resolvedReferences, selectedMemories: contextSeed.selectedMemories, semanticMemoryKeys: contextSeed.semanticMemoryKeys }, signal: requestAbortController.signal })
          const response = await runWithCeoCancellationContext(requestAbortController.signal, () => runCeoCognitiveLifecycle({ attachmentsCount: atts.length, messages: composed.messages, taskType: preRoute.taskClass, timeoutMs: executionContract.latencyBudgetMs, contextualEvidence: externalEvidenceContext, evidenceScope: externalEvidenceScope, evidenceFreshness: externalEvidenceFreshness, evidenceBundle: externalEvidenceBundle, priorConversation: safeContextRows, relevantOlderConversation: safeContextRows, preRoute, decisionPlan: turnDecision.decisionPlan, decisionContract, canonicalContext: composed.canonicalSemanticContext, partnerIntelligence, executiveState, leadershipLedger, strategicHorizon }))
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
          if (!responseSuperseded && !response.degraded) {
            await persistPostResponseDecisionMemory({ conversationRows: safeContextRows, userMessage: message, assistantMessage: response.content }).catch((memoryError) => console.warn('[api/agent] Post-response decision memory persistence failed:', memoryError instanceof Error ? memoryError.message.slice(0, 150) : String(memoryError)))
          }
          // Executive causal spine (2026-09-12): ventureId is the one link genuinely resolvable at this
          // call site from the current turn's own text -- strategyId and accountableLeaderId stay
          // unset here since nothing at this point matches a decision to a specific BusinessStrategy
          // item or leader; fabricating either would be worse than leaving them null.
          // Fixed 2026-09-21: this used extractVentureId(message) directly (null unless the user's raw
          // text literally spelled out "venture_001"), while every read of this same ledger
          // (getExecutiveBusinessState above, and calculateOperationalKpis/evaluateVentureReadiness
          // throughout venture-autonomy-control.ts) defaults an unmatched extraction to 'venture_001'.
          // Every real recommend/decide turn was silently written as ventureId: null and therefore
          // invisible to every venture-scoped read -- resolveVentureId() applies the identical default
          // used everywhere else, so the write side can no longer drift from the read side.
          if (!responseSuperseded && (decisionContract?.responseAction === 'recommend' || decisionContract?.responseAction === 'decide')) { const correlationId = generateRecommendationCorrelationId(); recordCeoRecommendation({ correlationId, objective: message, responseAction: decisionContract.responseAction, recommendedAction: response.content, decisionRationale: decisionContract.rationale.join('; '), ventureId: resolveVentureId(message) }).catch((error) => console.warn('[api/agent] Recommendation outcome capture failed:', error instanceof Error ? error.message.slice(0, 180) : String(error))) }
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
          // Phase 3b: the orchestrator is ACT-only. Its receipt is fed into the canonical
          // CEO lifecycle, which is now the sole RESPOND authority for every operational request.
          const emitExecutionOnly: OrchestratorEventEmit = async (event, data) => {
            if (event === 'token') return
            await emit(event, data)
          }
          const result = await withOrchestrationOwner('operational_orchestrator', () => runWithAgentRequestBudget(
            (signal) => runOrchestrator({
              conversationId,
              userMessage: message,
              attachments: atts,
              language: lang,
              emit: emitExecutionOnly,
              signal,
            } as OrchestratorRunOptionsWithSignal),
            requestBudgetMs,
            requestAbortController.signal,
          ))
          const operationalEvidence = result.executionSummary
          const operationalHandoff = classifyOperationalExecution(result)
          const operationalToolSteps = result.steps.filter((step) => Boolean(step.toolName))
          console.log('[api/agent] operational execution telemetry', JSON.stringify({
            requestId,
            completedSteps: result.steps.length,
            toolSteps: operationalToolSteps.length,
            executionStatus: result.executionStatus,
            completionReason: result.completionReason,
          }))

          const synthesisModules = buildCeoContextModules({
            intent: executionContract.intent,
            missionRelevant: preRoute.missionRelevant,
            evidenceClass: executionContract.evidenceClass,
            taskClass: preRoute.taskClass,
            executionRequirement: executionContract.executionRequirement,
            execution: operationalEvidence,
            attachments: atts.length ? attachmentContextSuffix(atts) : undefined,
            selfInspection: selfInspectionContext,
            knowledge: knowledgeContext,
            capabilityBriefing: capabilityBriefingContext,
          })
          const composedOperational = await composeCeoContext({
            systemPrompt: buildCeoSystemPrompt(),
            currentUserMessage: message,
            persistedMessages: safeContextRows,
            memories: contextData.memories,
            modules: synthesisModules,
            semanticInterpretation,
            reuseSemanticContext: {
              conversationState: contextSeed.conversationState,
              canonicalSemanticContext: contextSeed.canonicalSemanticContext,
              decisionContract: contextSeed.decisionContract,
              resolvedReferences: contextSeed.resolvedReferences,
              selectedMemories: contextSeed.selectedMemories,
              semanticMemoryKeys: contextSeed.semanticMemoryKeys,
            },
            signal: requestAbortController.signal,
          })

          const synthesis = await runWithCeoCancellationContext(
            requestAbortController.signal,
            () => runCeoCognitiveLifecycle({
              attachmentsCount: atts.length,
              messages: composedOperational.messages,
              taskType: preRoute.taskClass,
              timeoutMs: Math.min(60000, requestBudgetMs),
              contextualEvidence: operationalEvidence,
              evidenceScope: operationalHandoff.evidenceScope,
              evidenceFreshness: operationalHandoff.evidenceFreshness,
              externalExecutionSucceeded: operationalHandoff.externalExecutionSucceeded,
              priorConversation: safeContextRows,
              relevantOlderConversation: safeContextRows,
              preRoute,
              decisionPlan: turnDecision.decisionPlan,
              decisionContract,
              canonicalContext: composedOperational.canonicalSemanticContext,
              partnerIntelligence,
              executiveState,
              leadershipLedger,
              strategicHorizon,
            }),
          )
          const metrics = buildCeoRuntimeMetrics({ result: synthesis, decisionContract })
          logCeoRuntimeMetrics(metrics, requestId)

          let persistedAssistantMessageId: string | null = null
          let responseSuperseded = false
          const synthesisProvenance = synthesis.quality.finalResponseProvenance
          if (synthesisProvenance) {
            try {
              persistedAssistantMessageId = await persistCeoAssistantMessage({
                conversationId,
                content: synthesis.content,
                provenance: synthesisProvenance,
                capturedTurnSequence: myTurnSequence,
              })
            } catch (persistErr: any) {
              if (persistErr instanceof CeoResponseSupersededError) {
                responseSuperseded = true
                await recordSupersededCeoResponse({
                  conversationId,
                  content: synthesis.content,
                  capturedTurnSequence: myTurnSequence,
                  latestRevision: persistErr.latestRevision,
                }).catch((auditErr) => console.warn('[api/agent] Superseded-synthesis audit logging failed:', auditErr instanceof Error ? auditErr.message.slice(0, 150) : String(auditErr)))
              } else {
                console.warn('[api/agent] Operational synthesis history persistence failed:', persistErr?.message?.slice(0, 150))
                throw persistErr
              }
            }
          } else {
            throw new Error('CEO_RESPONSE_PERSISTENCE_PROVENANCE_MISSING')
          }

          if (!responseSuperseded && !synthesis.degraded) {
            await persistPostResponseDecisionMemory({ conversationRows: safeContextRows, userMessage: message, assistantMessage: synthesis.content }).catch((memoryError) => console.warn('[api/agent] Post-response decision memory persistence failed:', memoryError instanceof Error ? memoryError.message.slice(0, 150) : String(memoryError)))
          }
          if (!responseSuperseded) notifyMissionOutcome({ conversationId, content: synthesis.content, steps: result.steps, executionStatus: result.executionStatus }).catch(() => {})

          streamOutcome = responseSuperseded ? 'degraded' : (synthesis.degraded ? 'degraded' : 'completed')
          console.log('[ceo-request-trace]', JSON.stringify({
            requestId,
            endpoint: '/api/agent',
            deploymentId: releaseAttestation.deploymentId,
            executedCommitSha: releaseAttestation.executedCommitSha,
            fingerprint: releaseAttestation.fingerprint,
            outcome: streamOutcome,
            executionPath: synthesis.decisionPlan.path,
            provider: synthesis.provider,
            model: synthesis.model,
            superseded: responseSuperseded,
          }))
          if (responseSuperseded) {
            safeEnqueue(sse('superseded', {
              reason: 'A newer message in this conversation was already accepted before the executive synthesis finished computing, so it was not written as the current answer.',
              deployment: deploymentIdentity,
              requestId,
              releaseAttestation,
            }))
            safeEnqueue(sse('done', {
              messageId: persistedAssistantMessageId,
              steps: result.steps.length,
              executionClass: synthesis.decisionPlan.path,
              deployment: deploymentIdentity,
              requestId,
              releaseAttestation,
              decisionContract,
              executionContract,
              recoveryCount: recoveryBudget.used,
            }))
          } else {
            safeEnqueue(sse('answer', {
              content: synthesis.content,
              provider: synthesis.provider,
              model: synthesis.model,
              executionClass: synthesis.decisionPlan.path,
              evidenceState: synthesis.evidenceState,
              quality: synthesis.quality,
              cognitiveMetrics: metrics,
              responseMs: synthesis.responseMs,
              deployment: deploymentIdentity,
              requestId,
              releaseAttestation,
              decisionContract,
              executionContract,
              operationalSteps: result.steps.length,
              context: {
                recentMessages: contextSeed.recentMessages,
                relevantOlderMessages: contextSeed.relevantOlderMessages,
                summarizedOlderMessages: contextSeed.summarizedOlderMessages,
                selectedMemoryKeys: contextSeed.selectedMemoryKeys,
                modules: composedOperational.modules,
              },
            }))
            safeEnqueue(sse('done', {
              messageId: persistedAssistantMessageId,
              steps: result.steps.length + 1,
              executionClass: synthesis.decisionPlan.path,
              provider: synthesis.provider,
              model: synthesis.model,
              evidenceState: synthesis.evidenceState,
              deployment: deploymentIdentity,
              requestId,
              releaseAttestation,
              cognitiveMetrics: metrics,
              decisionContract,
              executionContract,
              recoveryCount: recoveryBudget.used,
            }))
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
function stripDataUrl(a: AttachmentMeta) { return { filename: a.filename, originalName: a.originalName, mimeType: a.mimeType, size: a.size, textContent: a.textContent ? a.textContent.slice(0, 8000) : undefined, remote: a.remote } }
