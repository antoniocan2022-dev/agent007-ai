import { buildCeoOperatorPlan, canClaimExecution } from './ceo-operator-intelligence'
import { buildSemanticQualityReport, buildSemanticRepairPlan, renderSemanticRepairPrompt } from './ceo-semantic-quality-report'
import { runCanonicalLlm, type CanonicalLlmResult } from './canonical-llm-router'
import { buildCeoDecisionPlan } from './ceo-cognitive-kernel'
import { preRouteCeoRequest, resolvePreRoute } from './ceo-pre-router'
import { buildCeoExecutionPlan } from './ceo-execution-plan'
import { evaluateCeoQuality } from './ceo-response-quality-gate'
import { buildCeoDegradedResponse } from './ceo-degraded-mode'
import { composeCeoResponse } from './ceo-response-composer'
import { getCeoVentureEvidenceForObjective } from './ceo-venture-state'
import { synthesizeExecutiveReadiness } from './ceo-self-reflection'
import { getConfiguredProviders, PROVIDER_ORDER } from './provider-control-plane'
import { isCircuitOpen } from './provider-intelligence'
import { probeProvider } from './provider-runtime-v2'
import type { ActiveProviderId } from './provider-control-plane'
import type { TaskType, VerificationTier } from './subagent-governance'
import type { CognitiveLifecycleResult, EvidenceScope, EvidenceFreshness, EvidenceState, PreRouteDecision } from './ceo-cognitive-contract'
import type { ConversationDecisionContract } from './ceo-conversation-decision-contract'
import type { CanonicalConversationContext } from './ceo-cognitive-conversation'
import { buildCeoWorldModel } from './ceo-world-model'
import type { CeoFailureReason } from './ceo-failure-reason'
import type { PersistedConversationRow } from './ceo-context-composer'
import { getCeoCancellationSignal } from './ceo-cancellation-context'
import { isCeoRequestAborted, throwIfCeoRequestAborted } from './ceo-cancellation'
import { isGovernedSoftPassEligible } from './ceo-soft-pass-policy'

export interface CeoCognitiveRequest {
  messages: readonly { role: 'system' | 'user' | 'assistant'; content: string }[]
  attachmentsCount?: number
  missionId?: string
  contextualEvidence?: string
  evidenceScope?: EvidenceScope
  evidenceFreshness?: EvidenceFreshness
  productionTrafficVerified?: boolean
  taskType?: TaskType
  verification?: VerificationTier
  model?: string
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
  priorConversation?: readonly PersistedConversationRow[]
  relevantOlderConversation?: readonly PersistedConversationRow[]
  preRoute?: PreRouteDecision
  decisionContract?: ConversationDecisionContract
  canonicalContext?: CanonicalConversationContext
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
function buildSynthesisPrompt(objective: string, draft: string, review: string, ventureEvidence?: string, readinessEvidence?: string): { role: 'user'; content: string } {
  return { role: 'user', content: `Produce the final executive answer. Preserve correct information from the draft, fix every material issue identified by the review, and do not invent facts. The answer must directly satisfy the original objective and clearly distinguish verified facts from assumptions when relevant.${ventureEvidence ? `\n\nLIVE VENTURE EVIDENCE:\n${ventureEvidence}` : ''}${readinessEvidence ? `\n\nGOVERNED EXECUTIVE READINESS SYNTHESIS (INTERNAL EVIDENCE; DO NOT UPGRADE UNPROVEN LEVELS):\n${readinessEvidence}` : ''}\n\nORIGINAL OBJECTIVE:\n${objective}\n\nDRAFT:\n${draft.slice(0, 30000)}\n\nINDEPENDENT REVIEW:\n${review.slice(0, 20000)}` }
}
function stageExclusions(previous?: ActiveProviderId): ActiveProviderId[] {
  const operational = getConfiguredProviders().filter((provider) => !isCircuitOpen(provider))
  return previous && operational.length >= 3 ? [previous] : []
}
function responseActionInstruction(action?: ConversationDecisionContract['responseAction']): string | null {
  if (!action) return null
  const instructions: Record<ConversationDecisionContract['responseAction'], string> = {
    answer: 'Response action: answer the user directly and naturally.',
    clarify: 'Response action: ask one concise, natural clarification question only when necessary to safely resolve the missing meaning. Do not repeat questions already answered by context.',
    explain: 'Response action: explain the requested concept or reasoning clearly, using the relevant context and avoiding unnecessary procedural structure.',
    challenge: 'Response action: respectfully challenge the user’s assumption or proposed conclusion when warranted, explain why, and offer the stronger alternative.',
    recommend: 'Response action: make a clear recommendation, choose a preferred option when the evidence supports one, and explain the decision criteria.',
    decide: 'Response action: give a decisive executive judgment, distinguish facts from assumptions, and state the chosen direction clearly.',
    execute: 'Response action: report the governed execution result accurately. Never claim an action occurred unless the execution path actually completed it.',
    verify: 'Response action: verify the requested claim or state using the governed evidence/execution path, and clearly distinguish verified, unverified, and unknown.',
  }
  return instructions[action]
}

async function attemptValidatedReasoningProvider(timeoutMs: number): Promise<ValidatedAvailability> {
  const configured = getConfiguredProviders(); const attemptBudget = Math.min(configured.length, 2)
  for (const provider of configured.slice(0, attemptBudget)) {
    try {
      const probe = await probeProvider(provider, { taskType: 'reasoning', verification: 'standard', timeoutMs: Math.max(2500, Math.min(10000, timeoutMs)), maxTokens: 128 })
      if (probe.success && probe.model && probe.responseMs !== null) return { provider, model: probe.model, responseMs: probe.responseMs }
    } catch (error) {
      if (isCeoRequestAborted(error)) throw error
    }
  }
  return null
}

function logCeoDegradedTrace(context: { objective: string; intent: string; path: string; failureReason?: CeoFailureReason; attempts: string[]; rawContentLength?: number; qualityChecks?: Record<string, boolean>; priorTurnCount?: number }): void {
  console.log('[ceo-degraded-trace]', JSON.stringify({ objectiveLength: context.objective.length, intent: context.intent, path: context.path, failureReason: context.failureReason, attempts: context.attempts, rawContentLength: context.rawContentLength ?? 0, qualityChecks: context.qualityChecks, priorTurnCount: context.priorTurnCount ?? 0 }))
}

async function semanticSubstanceCheck(objective: string, content: string): Promise<{ substantive: boolean; checked: boolean }> {
  try {
    const judge = await runCanonicalLlm({
      messages: [
        { role: 'system', content: 'You judge whether a conversational answer is substantive (specific, engages genuinely with the question, gives real reasoning or detail) or shallow (generic, hand-wavy, could apply to almost any question). Respond with exactly one word: SUBSTANTIVE or SHALLOW. No other text.' },
        { role: 'user', content: `Question: ${objective.slice(0, 500)}\n\nAnswer: ${content.slice(0, 1500)}` },
      ], taskType: 'reasoning', executionClass: 'fast', temperature: 0, maxTokens: 10, timeoutMs: 6000, maxProviderAttempts: 1,
    })
    const verdict = judge.content.trim().toUpperCase()
    if (verdict.includes('SHALLOW')) return { substantive: false, checked: true }
    if (verdict.includes('SUBSTANTIVE')) return { substantive: true, checked: true }
    return { substantive: true, checked: false }
  } catch (error) {
    if (isCeoRequestAborted(error)) throw error
    return { substantive: true, checked: false }
  }
}

async function tryDegraded(request: CeoCognitiveRequest, reason: string, attempts: string[], responseMsBeforeDegraded: number, decisionPlan: ReturnType<typeof buildCeoDecisionPlan>, executionPlan: ReturnType<typeof buildCeoExecutionPlan>, availabilityAttempted = false, validatedAvailability: ValidatedAvailability = null, failureReason?: CeoFailureReason): Promise<CognitiveLifecycleResult> {
  throwIfCeoRequestAborted(getCeoCancellationSignal())
  const started = Date.now(); let availability = validatedAvailability
  if (!availability && !availabilityAttempted) availability = await attemptValidatedReasoningProvider(Math.max(2500, (request.timeoutMs ?? decisionPlan.latencyBudgetMs) - responseMsBeforeDegraded))
  const evidenceScope = request.evidenceScope ?? (decisionPlan.executionContract.intent === 'self_assessment' ? 'internal_state' : undefined)
  const evidenceFreshness = request.evidenceFreshness
  if (availability) {
    try {
      const recovery = await runCanonicalLlm({ messages: request.messages, taskType: decisionPlan.executionContract.intent === 'self_assessment' ? 'reasoning' : (request.taskType ?? (decisionPlan.taskClass ?? 'reasoning')), verification: request.verification ?? 'standard', model: availability.model, temperature: request.temperature ?? 0.2, maxTokens: request.maxTokens ?? 4000, timeoutMs: Math.max(1000, Math.min(30000, (request.timeoutMs ?? decisionPlan.latencyBudgetMs) - (Date.now() - started))), maxProviderAttempts: 1, excludeProviders: PROVIDER_ORDER.filter((provider) => provider !== availability!.provider) })
      const recoveryQuality = evaluateCeoQuality({ objective: objectiveFrom(request.messages), content: recovery.content, path: decisionPlan.path, intent: decisionPlan.executionContract.intent, reviewed: false, externalExecutionSucceeded: true, evidenceProvided: Boolean(request.contextualEvidence?.trim()), evidenceScope, evidenceFreshness, priorTurns: request.priorConversation, relevantOlderMessages: request.relevantOlderConversation })
      const mergedAttempts = [...new Set([...attempts, availability.provider, ...recovery.attempts])]
      if (recovery.content.trim() && recoveryQuality.decision === 'PASS') return { content: composeCeoResponse({ content: recovery.content, evidenceState: recoveryQuality.evidenceState, quality: recoveryQuality, degraded: false }), provider: recovery.provider, model: recovery.model, responseMs: responseMsBeforeDegraded + (Date.now() - started), attempts: mergedAttempts, executionPlan, decisionPlan, quality: recoveryQuality, evidenceState: recoveryQuality.evidenceState, degraded: false, failureReason: recoveryQuality.failureReason }
    } catch (error) {
      if (isCeoRequestAborted(error)) throw error
    }
  }
  throwIfCeoRequestAborted(getCeoCancellationSignal())
  const degraded = await buildCeoDegradedResponse({ objective: objectiveFrom(request.messages), intent: decisionPlan.executionContract.intent, responseAction: request.decisionContract?.responseAction, selfReflectionKind: decisionPlan.executionContract.selfReflectionKind, reason, failureReason, missionId: request.missionId, contextualEvidence: request.contextualEvidence, priorConversation: request.priorConversation })
  throwIfCeoRequestAborted(getCeoCancellationSignal())
  const responseMs = responseMsBeforeDegraded + (Date.now() - started)
  const quality = { decision: 'DEGRADED' as const, evidenceState: degraded.evidenceState, verificationStatus: 'NOT_PERFORMED' as const, checks: { nonEmpty: Boolean(degraded.content.trim()), contractValid: degraded.content.length <= 100_000, objectiveCoverage: false, internalConsistency: true, evidenceDiscipline: true, actionableStructure: true }, evidenceScope, evidenceFreshness, claimScopes: [], failureReason: degraded.failureReason, reasons: [reason, ...(degraded.sourceKeys.length ? [`Recovered ${degraded.sourceKeys.length} internal evidence item(s).`] : [])] }
  return { content: composeCeoResponse({ content: degraded.content, evidenceState: degraded.evidenceState, quality, degraded: true }), responseMs, attempts, executionPlan, decisionPlan, quality, evidenceState: degraded.evidenceState, degraded: true, failureReason: degraded.failureReason }
}

export async function runCeoCognitiveLifecycle(request: CeoCognitiveRequest): Promise<CognitiveLifecycleResult> {
  const preRoute = request.preRoute ?? preRouteCeoRequest(request.messages, request.attachmentsCount ?? 0)
  const resolved = resolvePreRoute(preRoute)
  const decisionPlan = buildCeoDecisionPlan({ messages: request.messages, preRoute, missionId: request.missionId, taskType: request.taskType })
  const executionPlan = buildCeoExecutionPlan(decisionPlan)
  const objective = objectiveFrom(request.messages)
  const startedAt = Date.now()
  const deadline = startedAt + (request.timeoutMs ?? decisionPlan.latencyBudgetMs)
  const selectedVerification: VerificationTier = request.verification ?? (decisionPlan.qualityTier === 'critical' ? 'strict' : decisionPlan.qualityTier === 'high' ? 'enhanced' : 'standard')
  let ventureEvidence: { ventureId: string; evidence: string } | null = null; let ventureEvidenceFreshness: EvidenceFreshness | undefined
  try {
    ventureEvidence = await getCeoVentureEvidenceForObjective(objective)
    if (ventureEvidence) ventureEvidenceFreshness = { observedAt: Date.now(), maxAgeMs: 300000 }
  } catch (error) {
    if (/\bventure_\d{3}\b/i.test(objective)) {
      if (isCeoRequestAborted(error)) throw error
      const availability = await attemptValidatedReasoningProvider(Math.max(2500, deadline - Date.now()))
      logCeoDegradedTrace({ objective, intent: decisionPlan.executionContract.intent, path: decisionPlan.path, failureReason: 'context_unavailable', attempts: [] })
      return tryDegraded(request, `Live Venture state could not be read: ${error instanceof Error ? error.message : String(error)}`.slice(0, 700), [], Date.now() - startedAt, decisionPlan, executionPlan, true, availability, 'context_unavailable')
    }
  }
  const evidenceProvided = Boolean(request.contextualEvidence?.trim() || ventureEvidence?.evidence)
  const evidenceScope: EvidenceScope | undefined = request.evidenceScope ?? (ventureEvidence ? 'live_system' : decisionPlan.executionContract.intent === 'self_assessment' ? 'internal_state' : undefined)
  const evidenceFreshness = request.evidenceFreshness ?? ventureEvidenceFreshness
  const readinessSynthesis = decisionPlan.executionContract.selfReflectionKind === 'readiness_assessment' ? synthesizeExecutiveReadiness({ operationalCapabilityVerified: true, liveExecutionVerified: evidenceScope === 'live_system' && Boolean(evidenceFreshness), productionTrafficVerified: request.productionTrafficVerified === true, repeatableBusinessOutcomesVerified: false, sustainedAutonomyVerified: false, observedAt: evidenceFreshness?.observedAt, maxEvidenceAgeMs: evidenceFreshness?.maxAgeMs }) : null
  const worldModel = request.canonicalContext ? buildCeoWorldModel({ context: request.canonicalContext, priorConversation: request.priorConversation, olderConversation: request.relevantOlderConversation }) : null
  const worldModelMessages = worldModel ? [{ role: 'system' as const, content: `SYSTEM/EXTERNAL AWARENESS (INTERNAL, do not quote verbatim to the user):\nArchitecture: ${worldModel.system.data.architecture.join('; ')}\nDeployment: ${worldModel.system.data.deploymentState.join('; ')}\nExternal evidence available: ${worldModel.external.data.evidenceState === 'available' ? 'yes' : 'no'}` }] : []
  const liveSystemMessages = ventureEvidence ? [{ role: 'system' as const, content: `LIVE VENTURE STATE (READ ONLY):\n${ventureEvidence.evidence}\nUse these values as system evidence. Do not invent missing values, readiness, revenue, customer success, or authorization.` }] : []
  const readinessMessages = readinessSynthesis ? [{ role: 'system' as const, content: `GOVERNED EXECUTIVE READINESS BASELINE (INTERNAL):\nLevel ${readinessSynthesis.level} — ${readinessSynthesis.label}.\n${readinessSynthesis.capability}\n${readinessSynthesis.verified}\n${readinessSynthesis.notProven}\nNext evidence: ${readinessSynthesis.nextEvidence}` }] : []
  const actionInstruction = responseActionInstruction(request.decisionContract?.responseAction)
  const operatorPlan = request.decisionContract?.responseAction === 'execute'
    ? buildCeoOperatorPlan({ contract: decisionPlan.executionContract, responseAction: request.decisionContract.responseAction, objective, approved: true, executionEvidence: evidenceProvided, verificationState: evidenceScope === 'live_system' && evidenceFreshness ? 'LIVE_VERIFIED' : undefined })
    : null
  const operatorConstraint = operatorPlan && !canClaimExecution(operatorPlan)
    ? ` No execution has actually occurred for this request (status: ${operatorPlan.status}). Do not say or imply that you performed, deployed, executed, or completed anything. Describe what you would do and what is still required (${operatorPlan.tasks[0]?.dependencies.join(', ') || 'approval and verification'}) instead.`
    : ''
  const decisionMessages = actionInstruction ? [{ role: 'system' as const, content: `CANONICAL RESPONSE POLICY:\n${actionInstruction}${operatorConstraint}` }] : []
  const primaryMessages = [...worldModelMessages, ...liveSystemMessages, ...readinessMessages, ...decisionMessages, ...request.messages]
  const stageOptions = (overrides: Record<string, unknown> = {}) => ({ taskType: decisionPlan.executionContract.intent === 'self_assessment' ? 'reasoning' : (request.taskType ?? decisionPlan.taskClass ?? 'reasoning'), verification: selectedVerification, model: request.model, temperature: request.temperature, maxTokens: request.maxTokens, maxProviderAttempts: decisionPlan.maxProviderAttempts, timeoutMs: Math.max(1000, Math.min(60000, deadline - Date.now())), executionClass: resolved === 'fast' ? 'fast' as const : decisionPlan.path === 'critical' ? 'mission' as const : decisionPlan.path === 'full' ? 'deep' as const : 'standard' as const, ...overrides })
  let primary: CanonicalLlmResult | undefined; let review: CanonicalLlmResult | undefined; let final: CanonicalLlmResult | undefined; let escalation = 0
  try {
    const action = request.decisionContract?.responseAction
    if (action === 'clarify') {
      primary = await runCanonicalLlm({ ...stageOptions({ maxProviderAttempts: 1, maxTokens: Math.min(request.maxTokens ?? 600, 600), executionClass: 'fast' as const }), messages: [...decisionMessages, ...request.messages, { role: 'user', content: 'Ask the minimum necessary natural clarification needed to resolve the user’s request. Return only the clarification question.' }] })
    } else {
      primary = await runCanonicalLlm({ ...stageOptions(), messages: primaryMessages })
      if (executionPlan.reasoningStrategy === 'multi_pass') {
        const refinement = await runCanonicalLlm({ ...stageOptions({ maxProviderAttempts: 2 }), messages: [...primaryMessages, { role: 'assistant', content: primary.content }, buildRefinementPrompt(objective, primary.content)], excludeProviders: stageExclusions(primary.provider) })
        review = refinement; final = refinement
      } else if (executionPlan.reasoningStrategy === 'independent_review') {
        review = await runCanonicalLlm({ ...stageOptions({ maxProviderAttempts: 2 }), messages: [...liveSystemMessages, ...readinessMessages, ...decisionMessages, { role: 'system', content: 'You are an independent verification reviewer for Agent007. Be skeptical, precise, and concise.' }, buildReviewPrompt(objective, primary.content)], excludeProviders: stageExclusions(primary.provider) })
        final = await runCanonicalLlm({ ...stageOptions({ maxProviderAttempts: 2 }), messages: [...liveSystemMessages, ...readinessMessages, ...decisionMessages, { role: 'system', content: 'You are the final executive synthesizer for Agent007. Use the draft and independent review to produce the strongest justified answer.' }, buildSynthesisPrompt(objective, primary.content, review.content, ventureEvidence?.evidence, readinessSynthesis ? `Level ${readinessSynthesis.level} — ${readinessSynthesis.label}. ${readinessSynthesis.verified} ${readinessSynthesis.notProven}` : undefined)], excludeProviders: stageExclusions(review.provider) })
      }
    }
    let output = final ?? primary
    if (!output) return tryDegraded(request, 'No usable provider output was produced.', [], Date.now() - startedAt, decisionPlan, executionPlan, false, null, 'provider_unavailable')
    let quality = evaluateCeoQuality({ objective, content: output.content, path: decisionPlan.path, intent: decisionPlan.executionContract.intent, reviewed: Boolean(review && executionPlan.reasoningStrategy === 'independent_review'), externalExecutionSucceeded: true, evidenceProvided, evidenceScope, evidenceFreshness, priorTurns: request.priorConversation, relevantOlderMessages: request.relevantOlderConversation })
    while (quality.decision === 'ESCALATE' && escalation < decisionPlan.maxEscalations && Date.now() < deadline) {
      escalation += 1
      const lastProvider = final?.provider ?? review?.provider ?? primary?.provider
      try {
        const escalated = await runCanonicalLlm({ ...stageOptions({ maxProviderAttempts: 2 }), messages: [...liveSystemMessages, ...readinessMessages, ...decisionMessages, { role: 'system', content: 'You are an escalation reviewer. Repair the response only where the quality gate found material issues. Do not invent evidence.' }, { role: 'user', content: `Objective:\n${objective}\n\nCandidate:\n${output.content}\n\nQuality findings:\n${quality.reasons.join(' | ')}` }], excludeProviders: stageExclusions(lastProvider) })
        final = escalated; output = escalated
        quality = evaluateCeoQuality({ objective, content: escalated.content, path: decisionPlan.path, intent: decisionPlan.executionContract.intent, reviewed: true, externalExecutionSucceeded: true, evidenceProvided, evidenceScope, evidenceFreshness, priorTurns: request.priorConversation, relevantOlderMessages: request.relevantOlderConversation })
        if (quality.decision === 'PASS') break
      } catch (error) {
        if (isCeoRequestAborted(error)) throw error
        break
      }
    }
    const result0 = final ?? primary
    if (!result0) return tryDegraded(request, 'Provider execution exhausted before a final answer was available.', mergeAttempts(primary, review, final), Date.now() - startedAt, decisionPlan, executionPlan, true, null, 'provider_unavailable')
    let result = result0
    if (request.decisionContract && quality.decision !== 'PASS' && ['conversation', 'opinion', 'decision', 'analysis'].includes(request.decisionContract.intent) && Date.now() < deadline) {
      const report = buildSemanticQualityReport({ quality, conversationQuality: quality.conversationQuality, contract: request.decisionContract, content: result.content })
      if (report.decision === 'REPAIR') {
        const plan = buildSemanticRepairPlan(report)
        try {
          const repaired = await runCanonicalLlm({ ...stageOptions({ maxProviderAttempts: 2 }), messages: [...primaryMessages, { role: 'assistant', content: result.content }, renderSemanticRepairPrompt(objective, result.content, plan)], excludeProviders: stageExclusions(result.provider) })
          const repairedQuality = evaluateCeoQuality({ objective, content: repaired.content, path: decisionPlan.path, intent: decisionPlan.executionContract.intent, reviewed: true, externalExecutionSucceeded: true, evidenceProvided, evidenceScope, evidenceFreshness, priorTurns: request.priorConversation, relevantOlderMessages: request.relevantOlderConversation })
          const repairedReport = buildSemanticQualityReport({ quality: repairedQuality, conversationQuality: repairedQuality.conversationQuality, contract: request.decisionContract, content: repaired.content })
          console.log('[ceo-semantic-repair]', JSON.stringify({ failedDimensions: report.failedDimensions, repairPriority: report.repairPriority, beforeDecision: report.decision, afterDecision: repairedReport.decision }))
          if (repairedReport.decision !== 'DEGRADE' && (repairedReport.failedDimensions.length < report.failedDimensions.length || repairedReport.contractSatisfied)) {
            result = repaired; final = repaired; quality = repairedQuality
          }
        } catch (error) {
          if (isCeoRequestAborted(error)) throw error
        }
      }
    }
    const authoritativeIntent = request.decisionContract?.intent
    const isConversational = ['conversation', 'opinion', 'decision', 'analysis'].includes(authoritativeIntent ?? decisionPlan.executionContract.intent)
    const isGenuineOverclaim = quality.failureReason === 'evidence_unavailable' || quality.failureReason === 'evidence_insufficient' || quality.failureReason === 'claim_consistency_failure'
    const conversationQuality = quality.conversationQuality
    const softPassCandidate = isConversational && !isGenuineOverclaim && (conversationQuality?.score ?? 0) >= 60
    const semanticCheck = (quality.decision !== 'PASS' && softPassCandidate) ? await semanticSubstanceCheck(objective, result.content) : { substantive: true, checked: false }
    const softPassEligible = isGovernedSoftPassEligible({ intent: decisionPlan.executionContract.intent, authoritativeIntent, qualityDecision: quality.decision, failureReason: quality.failureReason, conversationScore: conversationQuality?.score, substantive: semanticCheck.substantive })
    if (quality.decision !== 'PASS' && !softPassEligible) return tryDegraded(request, `Quality gate did not pass after the allowed escalation depth: ${quality.reasons.join(' | ')}`, mergeAttempts(primary, review, final), Date.now() - startedAt, decisionPlan, executionPlan, true, null, quality.failureReason)
    if (quality.decision !== 'PASS' && softPassEligible) console.log('[ceo-soft-pass]', JSON.stringify({ intent: decisionPlan.executionContract.intent, failureReason: quality.failureReason, contentLength: result.content.length, conversationQualityScore: conversationQuality?.score, semanticChecked: semanticCheck.checked }))
    const evidenceState: EvidenceState = quality.evidenceState
    console.log('[ceo-runtime-trace]', JSON.stringify({ intent: decisionPlan.executionContract.intent, path: decisionPlan.path, responseAction: request.decisionContract?.responseAction ?? null, provider: result.provider, model: result.model, contentLength: result.content.length, qualityDecision: quality.decision, evidenceState, responseMs: Date.now() - startedAt, degraded: false }))
    return { content: composeCeoResponse({ content: result.content, evidenceState, quality, degraded: false }), provider: result.provider, model: result.model, responseMs: Date.now() - startedAt, attempts: mergeAttempts(primary, review, final), executionPlan, decisionPlan, quality, evidenceState, degraded: false, failureReason: quality.failureReason }
  } catch (error) {
    if (isCeoRequestAborted(error)) throw error
    const availability = await attemptValidatedReasoningProvider(Math.max(2500, deadline - Date.now()))
    const failureReason: CeoFailureReason = error instanceof Error && /timeout|timed out/i.test(error.message) ? 'execution_timeout' : 'provider_error'
    logCeoDegradedTrace({ objective, intent: decisionPlan.executionContract.intent, path: decisionPlan.path, failureReason, attempts: mergeAttempts(primary, review, final), rawContentLength: (final ?? primary)?.content.length })
    return tryDegraded(request, error instanceof Error ? error.message.slice(0, 500) : 'All governed external execution paths failed.', mergeAttempts(primary, review, final), Date.now() - startedAt, decisionPlan, executionPlan, true, availability, failureReason)
  }
}
