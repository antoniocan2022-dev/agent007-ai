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
import { getAllPersistentMemory } from '@/lib/persistent-memory'
import { computeWorldStateDelta } from '@/lib/ceo-world-state'
import { buildConversationDecisionContract } from '@/lib/ceo-conversation-decision-contract'
import { buildCeoRuntimeMetrics, logCeoRuntimeMetrics } from '@/lib/ceo-runtime-metrics'
import { createReleaseAttestation, getReleaseIdentity, newReleaseRequestId } from '@/lib/release-attestation'
import { CeoRequestAbortedError, isCeoRequestAborted } from '@/lib/ceo-cancellation'
import { runWithCeoCancellationContext } from '@/lib/ceo-cancellation-context'
import { interpretCeoSemantics } from '@/lib/ceo-semantic-interpreter'
import { CEO_PERSONALITY_CHARTER } from '@/lib/ceo-personality'
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
  const payload = data && typeof data === 'object' && !Array.isArray(data) ? { ...(data as Record<string, unknown>), deploymentId: identity.deploymentId, releaseCommit: identity.releaseCommit } : { data, deploymentId: identity.deploymentId, releaseCommit: identity.releaseCommit }
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`
}
async function loadConversationContext(conversationId: string, userId: string): Promise<{ rows: PersistedConversationRow[]; memories: PersistedMemoryRow[] }> {
  let rows: PersistedConversationRow[] = []
  try {
    const conversation = await db.conversation.findFirst({ where: { id: conversationId, userId }, select: { Message: { orderBy: { createdAt: 'asc' }, select: { role: true, content: true, createdAt: true } } } })
    rows = (conversation?.Message ?? []).map((row) => ({ role: row.role, content: row.content, createdAt: row.createdAt }))
  } catch (error) {
    console.warn('[api/agent] Conversation rows load failed:', error instanceof Error ? error.message.slice(0, 180) : String(error))
  }
  let memories: PersistedMemoryRow[] = []
  try {
    memories = await db.memory.findMany({ where: { category: { notIn: ['evidence_trace'] } }, orderBy: { updatedAt: 'desc' }, take: 40, select: { key: true, value: true, category: true, updatedAt: true } })
  } catch (error) {
    console.warn('[api/agent] Direct memory query failed, falling back to file-backed store:', error instanceof Error ? error.message.slice(0, 180) : String(error))
    try {
      const fallback = await getAllPersistentMemory()
      memories = fallback.filter((entry) => entry.category !== 'evidence_trace').slice(0, 40).map((entry) => ({ key: entry.key, value: entry.value, category: entry.category, updatedAt: entry.createdAt }))
    } catch (fallbackError) {
      console.warn('[api/agent] File-backed memory fallback also failed:', fallbackError instanceof Error ? fallbackError.message.slice(0, 180) : String(fallbackError))
    }
  }
  return { rows, memories }
}
function buildSystemPrompt(): string {
  const identity = 'You are Agent007, the CEO and executive intelligence of a governed AI organization. Answer the user directly, naturally, accurately, and without claiming unperformed actions or verification.'
  const personality = CEO_PERSONALITY_CHARTER
  const governance = 'For self-assessment requests, evaluate readiness from governed internal organizational state; clearly distinguish known facts, inferred conclusions, current limitations, and unknowns. Do not invent live verification.'
  return `${identity}\n\n${personality}\n\n${governance}`
}

export async function POST(req: NextRequest) {
  await ensureDbReady().catch(() => {})
  const session = await getServerSession(authOptions)
  const sessionUserId = typeof (session?.user as { id?: unknown } | undefined)?.id === 'string' ? (session!.user as { id: string }).id : ''
  if (!sessionUserId) return new Response(JSON.stringify({ error: 'Authentication required.' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
  let body: any
  try { body = await req.json() } catch { return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } }) }
  const { message, conversationId, attachments, language } = body as { message?: string; conversationId?: string; attachments?: AttachmentMeta[]; language?: 'en' | 'zh' }
  if (!message || typeof message !== 'string') return new Response(JSON.stringify({ error: 'Missing "message"' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  if (!conversationId || typeof conversationId !== 'string') return new Response(JSON.stringify({ error: 'Missing "conversationId"' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
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
  } catch {
    req.signal.removeEventListener('abort', onRequestAbort)
    return new Response(JSON.stringify({ error: 'Unable to persist the conversation securely.' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
  }

  let contextSeed: CeoContextComposition = composeCeoContext({ systemPrompt: buildSystemPrompt(), currentUserMessage: message, persistedMessages: contextData.rows, memories: contextData.memories })
  let semanticInterpretation: Awaited<ReturnType<typeof interpretCeoSemantics>> = { source: 'deterministic' }
  try {
    semanticInterpretation = await interpretCeoSemantics(contextSeed.canonicalSemanticContext, requestAbortController.signal)
  } catch (error) {
    if (isCeoRequestAborted(error)) {
      req.signal.removeEventListener('abort', onRequestAbort)
      return new Response(JSON.stringify({ error: 'Request cancelled.' }), { status: 499, headers: { 'Content-Type': 'application/json' } })
    }
  }
  contextSeed = composeCeoContext({ systemPrompt: buildSystemPrompt(), currentUserMessage: message, persistedMessages: contextData.rows, memories: contextData.memories, semanticInterpretation })
  const preRoute = preRouteCeoRequest(contextSeed.messages, atts.length, contextSeed.canonicalSemanticContext)
  const resolvedPath = resolvePreRoute(preRoute)
  const executionContract = preRoute.executionContract
  const decisionContract = buildConversationDecisionContract(contextSeed.canonicalSemanticContext)
  const requestBudgetMs = Math.min(AGENT_REQUEST_BUDGET_MS, executionContract.latencyBudgetMs)

  const encoder = new TextEncoder()