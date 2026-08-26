import { runCanonicalLlm, type CanonicalLlmResult } from './canonical-llm-router'
import { buildCeoDecisionPlan } from './ceo-cognitive-kernel'
import { preRouteCeoRequest, resolvePreRoute } from './ceo-pre-router'
import { buildCeoExecutionPlan } from './ceo-execution-plan'
import { evaluateCeoQuality } from './ceo-response-quality-gate'
import { buildCeoDegradedResponse } from './ceo-degraded-mode'
import { composeCeoResponse } from './ceo-response-composer'
import { getCeoVentureEvidenceForObjective } from './ceo-venture-state'
import { getConfiguredProviders, PROVIDER_ORDER } from './provider-control-plane'
import { isCircuitOpen } from './provider-intelligence'
import { probeProvider } from './provider-runtime-v2'
import type { ActiveProviderId } from './provider-control-plane'
import type { TaskType, VerificationTier } from './subagent-governance'
import type { CognitiveLifecycleResult, EvidenceState } from './ceo-cognitive-contract'

export interface CeoCognitiveRequest {
  messages: readonly { role: 'system' | 'user' | 'assistant'; content: string }[]
  attachmentsCount?: number
  missionId?: string
  contextualEvidence?: string
  taskType?: TaskType
  verification?: VerificationTier
  model?: string
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
}

type ValidatedAvailability = { provider: ActiveProviderId; model: string; responseMs: number } | null

function objectiveFrom(messages: CeoCognitiveRequest['messages']): string {
  return [...messages].reverse().find((message) => message.role === 'user')?.content?.trim() ?? ''
}
function mergeAttempts(...results: Array<CanonicalLlmResult | undefined>): string[] {
  return [...new Set(results.flatMap((result) => result?.attempts ?? []))]
}
function buildRefinementPrompt(objective: string, draft: string): { role: 'user'; content: string } {
  return { role: 'user', content: `Produce a revised final answer for the original objective. Preserve correct information from the draft, repair omissions and unsupported claims, improve precision and completeness, and do not invent facts. Return the revised answer only.\n\nORIGINAL OBJECTIVE:\n${objective}\n\nDRAFT:\n${draft.slice(0, 30000)}` }
}
function buildReviewPrompt(objective: string, draft: string): { role: 'user'; content: string } {
  return { role: 'user', content: `Review the draft answer below against the original objective. Identify material omissions, unsupported claims, contradictions, and incorrect assumptions. Do not write a new answer; return a concise review that a synthesis step can act on.\n\nORIGINAL OBJECTIVE:\n${objective}\n\nDRAFT:\n${draft.slice(0, 30000)}` }
}
function buildSynthesisPrompt(objective: string, draft: string, review: string, ventureEvidence?: string): { role: 'user'; content: string } {
  return { role: 'user', content: `Produce the final executive answer. Preserve correct information from the draft, fix every material issue identified by the review, and do not invent facts. The answer must directly satisfy the original objective and clearly distinguish verified facts from assumptions when relevant.${ventureEvidence ? `\n\nLIVE VENTURE EVIDENCE:\n${ventureEvidence}` : ''}\n\nORIGINAL OBJECTIVE:\n${objective}\n\nDRAFT:\n${draft.slice(0, 30000)}\n\nINDEPENDENT REVIEW:\n${review.slice(0, 20000)}` }
}
function stageExclusions(previous?: ActiveProviderId): ActiveProviderId[] {
  const operational = getConfiguredProviders().filter((provider) => !isCircuitOpen(provider))
  return previous && operational.length >= 3 ? [previous] : []
}

async function attemptValidatedReasoningProvider(timeoutMs: number): Promise<ValidatedAvailability> {
  const configured = getConfiguredProviders()
  const attemptBudget = Math.min(configured.length, 2)
  for (const provider of configured.slice(0, attemptBudget)) {
    try {
      const probe = await probeProvider(provider, { taskType: 'reasoning', verification: 'standard', timeoutMs: Math.max(2500, Math.min(10000, timeoutMs)), maxTokens: 128 })
      if (probe.success && probe.model && probe.responseMs !== null) return { provider, model: probe.model, responseMs: probe.responseMs }
    } catch {
      // Availability checks are advisory; a failed check never becomes a false success.
    }
  }
  return null
}

async function tryDegraded(
  request: CeoCognitiveRequest,
  reason: string,
  attempts: string[],
  responseMsBeforeDegraded: number,
  decisionPlan: ReturnType<typeof buildCeoDecisionPlan>,
  executionPlan: ReturnType<typeof buildCeoExecutionPlan>,
  availabilityAttempted = false,
  validatedAvailability: ValidatedAvailability = null,
): Promise<CognitiveLifecycleResult> {
  const started = Date.now()
  let availability = validatedAvailability
  if (!availability && !availabilityAttempted) {
    availability = await attemptValidatedReasoningProvider(Math.max(2500, (request.timeoutMs ?? decisionPlan.latencyBudgetMs) - responseMsBeforeDegraded))
  }

  // A successful availability probe is not itself a response, but it proves a
  // governed reasoning path exists. Use that path before declaring degraded.
  if (availability) {
    try {
      const recovery = await runCanonicalLlm({
        messages: request.messages,
        taskType: request.taskType ?? 'general',
        verification: request.verification ?? 'standard',
        model: availability.model,
        temperature: request.temperature ?? 0.2,
        maxTokens: request.maxTokens ?? 4000,
        timeoutMs: Math.max(1000, Math.min(30000, (request.timeoutMs ?? decisionPlan.latencyBudgetMs) - (Date.now() - started))),
        maxProviderAttempts: 1,
        excludeProviders: PROVIDER_ORDER.filter((provider) => provider !== availability!.provider),
      })
      const recoveryQuality = evaluateCeoQuality({
        objective: objectiveFrom(request.messages),
        content: recovery.content,
        path: decisionPlan.path,
        reviewed: false,
        externalExecutionSucceeded: true,
        evidenceProvided: Boolean(request.contextualEvidence?.trim()),
      })
      const mergedAttempts = [...new Set([...attempts, availability.provider, ...recovery.attempts])]
      if (recovery.content.trim() && recoveryQuality.decision === 'PASS') {
        return {
          content: composeCeoResponse({ content: recovery.content, evidenceState: recoveryQuality.evidenceState, quality: recoveryQuality, degraded: false }),
          provider: recovery.provider,
          model: recovery.model,
          responseMs: responseMsBeforeDegraded + (Date.now() - started),
          attempts: mergedAttempts,
          executionPlan,
          decisionPlan,
          quality: recoveryQuality,
          evidenceState: recoveryQuality.evidenceState,
          degraded: false,
        }
      }
    } catch {
      // Recovery failed genuinely; proceed to persistent-evidence degraded mode.
    }
  }

  const degraded = await buildCeoDegradedResponse({ objective: objectiveFrom(request.messages), reason, missionId: request.missionId, contextualEvidence: request.contextualEvidence })
  const responseMs = responseMsBeforeDegraded + (Date.now() - started)
  const quality = {
    decision: 'DEGRADED' as const,
    evidenceState: degraded.evidenceState,
    verificationStatus: 'NOT_PERFORMED' as const,
    checks: { nonEmpty: Boolean(degraded.content.trim()), contractValid: degraded.content.length <= 100_000, objectiveCoverage: false, internalConsistency: true, evidenceDiscipline: true, actionableStructure: true },
    reasons: [reason, ...(degraded.sourceKeys.length ? [`Recovered ${degraded.sourceKeys.length} internal evidence item(s).`] : [])],
  }
  return { content: composeCeoResponse({ content: degraded.content, evidenceState: degraded.evidenceState, quality, degraded: true }), responseMs, attempts, executionPlan, decisionPlan, quality, evidenceState: degraded.evidenceState, degraded: true }
}

export async function runCeoCognitiveLifecycle(request: CeoCognitiveRequest): Promise<CognitiveLifecycleResult> {
  const preRoute = preRouteCeoRequest(request.messages, request.attachmentsCount ?? 0)
  const resolved = resolvePreRoute(preRoute)
  const decisionPlan = buildCeoDecisionPlan({ messages: request.messages, preRoute, missionId: request.missionId, taskType: request.taskType })
  const executionPlan = buildCeoExecutionPlan(decisionPlan)
  const objective = objectiveFrom(request.messages)
  const startedAt = Date.now()
  const deadline = startedAt + (request.timeoutMs ?? decisionPlan.latencyBudgetMs)
  const selectedVerification: VerificationTier = request.verification ?? (decisionPlan.qualityTier === 'critical' ? 'strict' : decisionPlan.qualityTier === 'high' ? 'enhanced' : 'standard')

  let ventureEvidence: { ventureId: string; evidence: string } | null = null
  try { ventureEvidence = await getCeoVentureEvidenceForObjective(objective) } catch (error) {
    if (/\bventure_\d{3}\b/i.test(objective)) {
      const availability = await attemptValidatedReasoningProvider(Math.max(2500, deadline - Date.now()))
      return tryDegraded(request, `Live Venture state could not be read: ${error instanceof Error ? error.message : String(error)}`.slice(0, 700), [], Date.now() - startedAt, decisionPlan, executionPlan, true, availability)
    }
  }

  const evidenceProvided = Boolean(request.contextualEvidence?.trim() || ventureEvidence?.evidence)
  const liveSystemMessages = ventureEvidence ? [{ role: 'system' as const, content: `LIVE VENTURE STATE (READ ONLY):\n${ventureEvidence.evidence}\nUse these values as system evidence. Do not invent missing values, readiness, revenue, customer success, or authorization.` }] : []
  const primaryMessages = [...liveSystemMessages, ...request.messages]
  const stageOptions = (overrides: Record<string, unknown> = {}) => ({
    taskType: request.taskType,
    verification: selectedVerification,
    model: request.model,
    temperature: request.temperature,
    maxTokens: request.maxTokens,
    maxProviderAttempts: decisionPlan.maxProviderAttempts,
    timeoutMs: Math.max(1000, Math.min(60000, deadline - Date.now())),
    executionClass: resolved === 'fast' ? 'fast' as const : decisionPlan.path === 'critical' ? 'mission' as const : decisionPlan.path === 'full' ? 'deep' as const : 'standard' as const,
    ...overrides,
  })

  let primary: CanonicalLlmResult | undefined
  let review: CanonicalLlmResult | undefined
  let final: CanonicalLlmResult | undefined
  let escalation = 0

  try {
    primary = await runCanonicalLlm({ ...stageOptions(), messages: primaryMessages })
    if (executionPlan.reasoningStrategy === 'multi_pass') {
      const refinement = await runCanonicalLlm({
        ...stageOptions({ maxProviderAttempts: 2 }),
        messages: [...primaryMessages, { role: 'assistant', content: primary.content }, buildRefinementPrompt(objective, primary.content)],
        excludeProviders: stageExclusions(primary.provider),
      })
      review = refinement; final = refinement
    } else if (executionPlan.reasoningStrategy === 'independent_review') {
      review = await runCanonicalLlm({
        ...stageOptions({ maxProviderAttempts: 2 }),
        messages: [
          ...(ventureEvidence ? [{ role: 'system' as const, content: ventureEvidence.evidence }] : []),
          { role: 'system', content: 'You are an independent verification reviewer for Agent007. Be skeptical, precise, and concise.' },
          buildReviewPrompt(objective, primary.content),
        ],
        excludeProviders: stageExclusions(primary.provider),
      })
      final = await runCanonicalLlm({
        ...stageOptions({ maxProviderAttempts: 2 }),
        messages: [
          ...(ventureEvidence ? [{ role: 'system' as const, content: ventureEvidence.evidence }] : []),
          { role: 'system', content: 'You are the final executive synthesizer for Agent007. Use the draft and independent review to produce the strongest justified answer.' },
          buildSynthesisPrompt(objective, primary.content, review.content, ventureEvidence?.evidence),
        ],
        excludeProviders: stageExclusions(review.provider),
      })
    }

    let output = final ?? primary
    if (!output) return tryDegraded(request, 'No usable provider output was produced.', [], Date.now() - startedAt, decisionPlan, executionPlan)
    let quality = evaluateCeoQuality({ objective, content: output.content, path: decisionPlan.path, reviewed: Boolean(review && executionPlan.reasoningStrategy === 'independent_review'), externalExecutionSucceeded: true, evidenceProvided })

    while (quality.decision === 'ESCALATE' && escalation < decisionPlan.maxEscalations && Date.now() < deadline) {
      escalation += 1
      const lastProvider = final?.provider ?? review?.provider ?? primary?.provider
      try {
        const escalated = await runCanonicalLlm({
          ...stageOptions({ maxProviderAttempts: 2 }),
          messages: [
            ...(ventureEvidence ? [{ role: 'system' as const, content: ventureEvidence.evidence }] : []),
            { role: 'system', content: 'You are an escalation reviewer. Repair the response only where the quality gate found material issues. Do not invent evidence.' },
            { role: 'user', content: `Objective:\n${objective}\n\nCandidate:\n${output.content}\n\nQuality findings:\n${quality.reasons.join(' | ')}` },
          ],
          excludeProviders: stageExclusions(lastProvider),
        })
        final = escalated
        output = escalated
        quality = evaluateCeoQuality({ objective, content: escalated.content, path: decisionPlan.path, reviewed: true, externalExecutionSucceeded: true, evidenceProvided })
        if (quality.decision === 'PASS') break
      } catch { break }
    }

    const result = final ?? primary
    if (!result) return tryDegraded(request, 'Provider execution exhausted before a final answer was available.', mergeAttempts(primary, review, final), Date.now() - startedAt, decisionPlan, executionPlan)
    if (quality.decision !== 'PASS') return tryDegraded(request, `Quality gate did not pass after the allowed escalation depth: ${quality.reasons.join(' | ')}`, mergeAttempts(primary, review, final), Date.now() - startedAt, decisionPlan, executionPlan)

    const evidenceState: EvidenceState = quality.evidenceState
    return { content: composeCeoResponse({ content: result.content, evidenceState, quality, degraded: false }), provider: result.provider, model: result.model, responseMs: Date.now() - startedAt, attempts: mergeAttempts(primary, review, final), executionPlan, decisionPlan, quality, evidenceState, degraded: false }
  } catch (error) {
    const availability = await attemptValidatedReasoningProvider(Math.max(2500, deadline - Date.now()))
    return tryDegraded(request, error instanceof Error ? error.message.slice(0, 500) : 'All governed external execution paths failed.', mergeAttempts(primary, review, final), Date.now() - startedAt, decisionPlan, executionPlan, true, availability)
  }
}