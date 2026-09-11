import { describe, expect, test } from 'bun:test'
import { buildCanonicalConversationContext } from '@/lib/ceo-cognitive-conversation'
import { buildConversationDecisionContract } from '@/lib/ceo-conversation-decision-contract'
import { deriveCeoConversationState } from '@/lib/ceo-conversation-state'
import { isGovernedSoftPassEligible } from '@/lib/ceo-soft-pass-policy'
import { semanticAssistanceRequired } from '@/lib/ceo-semantic-interpreter'
import type { PersistedConversationRow } from '@/lib/ceo-context-composer'

function row(role: 'user' | 'assistant', content: string, createdAt = Date.now()): PersistedConversationRow { return { role, content, createdAt } }
function context(message: string, rows: PersistedConversationRow[] = []): ReturnType<typeof buildCanonicalConversationContext> { const state = deriveCeoConversationState(rows, message); return buildCanonicalConversationContext({ currentMessage: message, rows, state, references: [] }) }

describe('CEO Phases 1-3 architecture contracts', () => {
  test('route has one canonical semantic interpretation and one direct pre-route call', async () => {
    const route = await Bun.file(new URL('../src/app/api/agent/route.ts', import.meta.url)).text()
    const lifecycle = await Bun.file(new URL('../src/lib/ceo-cognitive-lifecycle.ts', import.meta.url)).text()
    expect((route.match(/interpretCeoSemantics\(/g) ?? []).length).toBe(1)
    expect((route.match(/preRouteCeoRequest\(/g) ?? []).length).toBe(1)
    expect(route).toContain('preRouteCeoRequest(contextSeed.messages, atts.length, contextSeed.canonicalSemanticContext)')
    expect(route).toContain('preRoute, decisionContract')
    expect(lifecycle).toContain('request.preRoute ?? preRouteCeoRequest')
    expect(lifecycle).toContain('request.decisionContract?.responseAction')
  })

  test('canonical semantic context contains structured meaning, confidence and uncertainty', () => {
    const value = context('Can you explain this again?')
    expect(value.meaning.length).toBeGreaterThan(0)
    expect(value.semanticInterpretation.confidence).toBeGreaterThan(0)
    expect(Array.isArray(value.semanticInterpretation.uncertainty)).toBe(true)
  })

  test('low-confidence assisted meaning cannot replace deterministic meaning', () => {
    const value = context('What is the current architecture?')
    const assisted = buildCanonicalConversationContext({ currentMessage: 'What is the current architecture?', rows: [], state: value.state, references: [], semanticInterpretation: { source: 'hybrid', confidence: 0.4, meaning: 'A fabricated unrelated meaning', suggestedIntent: 'conversation' } })
    expect(assisted.meaning).toBe(value.meaning)
    expect(assisted.intentHint).toBe('analysis')
  })

  test('high-confidence assisted meaning can refine meaning while deterministic correction wins', () => {
    const value = context('wht about the routing decision?')
    const assisted = buildCanonicalConversationContext({ currentMessage: value.currentMessage, rows: [], state: value.state, references: [], semanticInterpretation: { source: 'hybrid', confidence: 0.9, meaning: 'Ask about the routing decision from the current conversation.', suggestedIntent: 'decision', suggestedSpeechAct: 'question', suggestedCognitiveDepth: 'strategic' } })
    expect(assisted.meaning).toContain('routing decision')
    expect(assisted.intentHint).toBe('decision')
    expect(assisted.speechAct).toBe('question')
  })

  test('semantic confidence and uncertainty affect the decision contract', () => {
    const base = context('What about that?')
    const cautious = buildConversationDecisionContract({ ...base, semanticInterpretation: { ...base.semanticInterpretation, source: 'hybrid', confidence: 0.5, uncertainty: [{ code: 'uncertain_reference', description: 'reference is unresolved', severity: 'high' }] } })
    const confident = buildConversationDecisionContract({ ...base, semanticInterpretation: { ...base.semanticInterpretation, source: 'hybrid', confidence: 0.9, uncertainty: [] } })
    expect(cautious.confidence).toBeLessThan(confident.confidence)
    expect(cautious.uncertainty.some((item) => item.code === 'uncertain_reference')).toBe(true)
  })

  test('explicit corrections remain corrections even when correction text contains ordinal language', () => {
    const value = context('No, I meant routing as the first engineering priority.')
    expect(value.speechAct).toBe('correction')
    expect(value.intentHint).toBe('conversation')
    expect(buildConversationDecisionContract(value).responseAction).toBe('answer')
  })

  test('decision contract exposes all Phase 3 response actions', () => {
    const cases: Array<[string, string]> = [
      ['Should we prioritize routing?', 'recommend'],
      ['Decide between option one and option two.', 'decide'],
      ['Please execute the approved change.', 'execute'],
      ['Can you verify whether the current state is correct?', 'verify'],
      ['Explain why this architecture is stronger.', 'explain'],
      ['I think option A is right; push back on my assumption.', 'challenge'],
    ]
    for (const [message, expected] of cases) expect(buildConversationDecisionContract(context(message)).responseAction).toBe(expected)
  })

  test('explicitly unresolved references require clarification, while resolved references remain answerable', () => {
    const rows = [row('user', 'We discussed several possible approaches.'), row('assistant', 'The options are A and B.')]
    const unresolved = context('What about that?', rows)
    const clarifyContract = buildConversationDecisionContract({ ...unresolved, references: [{ phrase: 'that', kind: 'pronoun', resolvedText: null, confidence: 0.3, ambiguous: true, candidates: [] }] })
    expect(clarifyContract.responseAction).toBe('clarify')
    expect(clarifyContract.clarificationRequired).toBe(true)

    const resolved = buildConversationDecisionContract({ ...unresolved, references: [{ phrase: 'that', kind: 'pronoun', resolvedText: 'the options are A and B', confidence: 0.96, ambiguous: false, candidates: [] }] })
    expect(resolved.clarificationRequired).toBe(false)
    expect(resolved.responseAction).not.toBe('clarify')
  })

  test('semantic assistance is requested for typo or targeted ambiguity signals, but not ordinary text', () => {
    expect(semanticAssistanceRequired(context('wht about that?'))).toBe(true)
    expect(semanticAssistanceRequired(context('This is a straightforward answer.'))).toBe(false)
    expect(semanticAssistanceRequired(context('This architecture is strong and this module is stable.'))).toBe(false)
  })

  test('soft pass is formally bounded and cannot bypass evidence, continuity, or claim-consistency failures', () => {
    expect(isGovernedSoftPassEligible({ intent: 'conversation', qualityDecision: 'ESCALATE', conversationScore: 82, substantive: true })).toBe(true)
    expect(isGovernedSoftPassEligible({ intent: 'conversation', qualityDecision: 'ESCALATE', failureReason: 'evidence_insufficient', conversationScore: 92, substantive: true })).toBe(false)
    expect(isGovernedSoftPassEligible({ intent: 'conversation', qualityDecision: 'ESCALATE', conversationScore: 74, substantive: true })).toBe(false)
    expect(isGovernedSoftPassEligible({ intent: 'conversation', qualityDecision: 'ESCALATE', failureReason: 'continuity_failure', conversationScore: 92, substantive: true })).toBe(false)
  })

  // Semantic continuity tie-breaker: the lexical continuity heuristics (staleResponseLikelihood/
  // scoreContextContinuity) are bag-of-words token-overlap scores, proven by a real production incident
  // to false-positive on a genuinely coherent response. semanticContinuityConfirmed is a real LLM
  // judgment call (semanticContinuityCheck in ceo-cognitive-lifecycle.ts), not another lexical proxy, and
  // it can rescue ONLY continuity_failure -- never the other three forbidden reasons, which are about
  // factual/evidentiary integrity, not conversational coherence.
  test('a confirmed semantic continuity judgment can rescue continuity_failure specifically', () => {
    expect(isGovernedSoftPassEligible({ intent: 'conversation', qualityDecision: 'ESCALATE', failureReason: 'continuity_failure', conversationScore: 92, substantive: true, semanticContinuityConfirmed: true })).toBe(true)
  })

  test('an unconfirmed or unchecked semantic continuity judgment does NOT rescue continuity_failure -- it must be positively confirmed, not merely not-denied', () => {
    expect(isGovernedSoftPassEligible({ intent: 'conversation', qualityDecision: 'ESCALATE', failureReason: 'continuity_failure', conversationScore: 92, substantive: true, semanticContinuityConfirmed: false })).toBe(false)
    expect(isGovernedSoftPassEligible({ intent: 'conversation', qualityDecision: 'ESCALATE', failureReason: 'continuity_failure', conversationScore: 92, substantive: true })).toBe(false)
  })

  test('the semantic continuity override cannot rescue evidence or claim-consistency failures, even when confirmed true', () => {
    for (const failureReason of ['evidence_unavailable', 'evidence_insufficient', 'claim_consistency_failure']) {
      expect(isGovernedSoftPassEligible({ intent: 'conversation', qualityDecision: 'ESCALATE', failureReason, conversationScore: 92, substantive: true, semanticContinuityConfirmed: true })).toBe(false)
    }
  })

  // Deep-audit finding, verified with a real probe before this fix existed: false_completion_claim and
  // internal_artifact_leak used to collapse into the generic 'quality_failure' reason, which was never on
  // FORBIDDEN_FAILURES -- so isGovernedSoftPassEligible returned true for both, given a high enough
  // conversationScore and substantive:true (a confident false claim reads as specific, not shallow; a
  // fluent response with an embedded artifact token can score just as well). Neither is overridable by
  // anything, including the semantic continuity confirmation that can rescue continuity_failure -- these
  // are about factual/artifact integrity, not conversational coherence.
  test('false_completion_claim and internal_artifact_leak are permanently forbidden from soft-pass, matching the factual/evidentiary reasons', () => {
    for (const failureReason of ['false_completion_claim', 'internal_artifact_leak']) {
      expect(isGovernedSoftPassEligible({ intent: 'decision', qualityDecision: 'ESCALATE', failureReason, conversationScore: 92, substantive: true })).toBe(false)
      expect(isGovernedSoftPassEligible({ intent: 'decision', qualityDecision: 'ESCALATE', failureReason, conversationScore: 92, substantive: true, semanticContinuityConfirmed: true })).toBe(false)
    }
  })

  // Deep-audit finding: SOFT_PASS_POLICY.requiresSemanticSubstanceCheck:true asserted a contract the
  // ceo-cognitive-lifecycle.ts call site did not actually enforce -- it passed semanticCheck.substantive
  // straight through, which defaults to true on both a confirmed SUBSTANTIVE verdict AND an unchecked
  // (inconclusive/errored) judge. Locks in that the call site combines both fields, matching what
  // isGovernedSoftPassEligible's own substantive:boolean input has always meant: a positively confirmed
  // judgment, not merely "not denied" -- the same standard already enforced for semanticContinuityConfirmed.
  test('the lifecycle wires the substance judge as checked-and-substantive, not substantive alone, honoring requiresSemanticSubstanceCheck', async () => {
    const lifecycle = await Bun.file(new URL('../src/lib/ceo-cognitive-lifecycle.ts', import.meta.url)).text()
    expect(lifecycle).toContain('substantive: semanticCheck.checked && semanticCheck.substantive')
    expect(lifecycle).not.toContain('substantive: semanticCheck.substantive,')
  })

  // Deep-audit finding: semanticContinuityCheck (the sole rescue path for continuity_failure) received only
  // request.priorConversation, while evaluateCeoQuality -- the gate that produces continuity_failure in the
  // first place -- also considers relevantOlderMessages. Locks in that the lifecycle now supplies the judge
  // with the same older-conversation context the gate itself relies on, so the override is never weaker
  // than the failure it exists to rescue.
  test('the lifecycle gives the continuity judge relevantOlderConversation, not just recent turns', async () => {
    const lifecycle = await Bun.file(new URL('../src/lib/ceo-cognitive-lifecycle.ts', import.meta.url)).text()
    expect(lifecycle).toContain('semanticContinuityCheck(objective, request.priorConversation ?? [], result.content, request.relevantOlderConversation ?? [])')
  })

  // Sibling-call-site audit: tryDegraded's recovery branch is the LAST chance to save a request, so
  // diffed its evaluateCeoQuality call against the primary/escalation/semantic-repair calls in
  // runCeoCognitiveLifecycle. It was missing resolvedReferences and responseAction, which every sibling
  // call passes -- meaning a recovery response using a correctly-resolved reference or satisfying the
  // requested action could still be marked continuity_failure or a requested-action miss purely because
  // the evaluation never saw the context that would have proven it satisfied. Locks in that the recovery
  // evaluation now receives the same contract-carrying fields every other stage's evaluation already does.
  test('the recovery-branch quality evaluation receives resolvedReferences and responseAction, matching every sibling evaluateCeoQuality call', async () => {
    const lifecycle = await Bun.file(new URL('../src/lib/ceo-cognitive-lifecycle.ts', import.meta.url)).text()
    expect(lifecycle).toContain('relevantOlderMessages: request.relevantOlderConversation, resolvedReferences: request.canonicalContext?.references, responseAction: request.decisionContract?.responseAction, externalAgencyAvailable: decisionPlan.executionContract.orchestrationOwner')
  })

  // Sibling-call-site audit: every other stage (primary, escalation, semantic repair) derives its
  // verification tier from selectedVerification, which upgrades to 'strict'/'enhanced' for
  // critical/high qualityTier requests. tryDegraded's recovery call hardcoded 'standard' regardless of
  // qualityTier, so a critical-tier request's last-resort recovery ran at a lower quality bar than every
  // stage that came before it in the same request. Locks in that recovery now derives the same tier.
  // Since extracted into the shared recoveryTaskContext helper (see the live-production
  // taskType-governance fix below), so this checks the helper's derivation directly.
  test('the recovery-branch generation call derives verification from decisionPlan.qualityTier, not a hardcoded standard tier', async () => {
    const lifecycle = await Bun.file(new URL('../src/lib/ceo-cognitive-lifecycle.ts', import.meta.url)).text()
    expect(lifecycle).toContain("verification: request.verification ?? (decisionPlan.qualityTier === 'critical' ? 'strict' : decisionPlan.qualityTier === 'high' ? 'enhanced' : 'standard'),")
    expect(lifecycle).toContain('verification: recoveryVerification, model: availability.model')
  })

  // Live-production finding, caught via a real runtime-log trace: "Weigh the tradeoffs between doubling
  // down on affiliate content vs. building a SaaS product" classifies taskType 'creative' (inferTaskType
  // matches the word "content"). Primary generation correctly narrowed to [mistral, openrouter] -- the
  // only providers governed for 'creative' -- per #115, and both failed for real reasons that request
  // (mistral:RATE_LIMIT:429, openrouter:UNKNOWN). Recovery then validated availability with
  // attemptValidatedReasoningProvider using a HARDCODED taskType 'reasoning' (universally governed), got
  // back groq, then generated with the request's real taskType 'creative' while excludeProviders locked
  // execution to ONLY groq -- which has zero governed models for 'creative'. The recovery attempt was
  // therefore guaranteed to fail with "No governed providers configured and healthy after exclusions",
  // not a flake, and the request degraded to the canned template live in production. Fixed by validating
  // availability against the real taskType/verification the recovery generation will use (both derived
  // once via recoveryTaskContext), so attemptValidatedReasoningProvider can never hand back a provider
  // recovery is structurally unable to use.
  test('attemptValidatedReasoningProvider validates against the real recovery taskType/verification, not a hardcoded reasoning/standard pair', async () => {
    const lifecycle = await Bun.file(new URL('../src/lib/ceo-cognitive-lifecycle.ts', import.meta.url)).text()
    expect(lifecycle).toContain("async function attemptValidatedReasoningProvider(timeoutMs: number, taskType: TaskType = 'reasoning', verification: VerificationTier = 'standard')")
    expect(lifecycle).toContain('const governedConfigured = configured.filter((provider) => getGovernedCandidates(provider, taskType, verification).length > 0)')
    expect(lifecycle).toContain('const probe = await probeProvider(provider, { taskType, verification, timeoutMs:')
    // Every call site passes the shared recoveryTaskContext derivation, not the old hardcoded default.
    const callSites = (lifecycle.match(/, recoveryTaskType, recoveryVerification\)/g) ?? []).length
    expect(callSites).toBe(3)
  })

  // Second-pass sibling-call-site audit, re-auditing the fix above: evidenceProvided/evidenceScope in
  // tryDegraded's recovery branch were STILL only derived from request-level evidence, never from
  // ventureEvidence -- the live Venture-state lookup runCeoCognitiveLifecycle performs once up front and
  // which every sibling evaluateCeoQuality call sees (they all read the evidenceScope/evidenceProvided
  // variables computed from it at the top of the function). tryDegraded is a standalone function with no
  // closure over that lookup, so a critical-tier response's recovery attempt could be marked as having no
  // live evidence -- and fail on exactly that basis -- even when real venture evidence was sitting in the
  // caller's scope, one parameter away. The recovery generation call had the same gap: it never received
  // that evidence either, so a "PASS" from it could have been ungrounded. Both are fixed by threading
  // ventureEvidence/ventureEvidenceFreshness through as parameters and injecting the same live-venture
  // system message runCeoCognitiveLifecycle's own liveSystemMessages construction uses.
  test('tryDegraded accepts ventureEvidence and ventureEvidenceFreshness, and every call site after the venture lookup passes them through', async () => {
    const lifecycle = await Bun.file(new URL('../src/lib/ceo-cognitive-lifecycle.ts', import.meta.url)).text()
    expect(lifecycle).toContain("generationOverride?: Partial<CeoGenerationDiagnostics>, ventureEvidence: { ventureId: string; evidence: string } | null = null, ventureEvidenceFreshness?: EvidenceFreshness): Promise<CognitiveLifecycleResult>")
    const callSitesPassingVentureEvidence = (lifecycle.match(/tryDegraded\([^;]*?, ventureEvidence, ventureEvidenceFreshness\)/g) ?? []).length
    // The 4 call sites downstream of the venture-evidence lookup (no-usable-output, exhausted-escalation,
    // quality-gate-failed, and the outer catch) must all pass it through; the 5th call site (the venture
    // lookup's own failure path) correctly relies on the null/undefined defaults since no evidence exists
    // yet at that point -- it is deliberately NOT one of these four.
    expect(callSitesPassingVentureEvidence).toBe(4)
  })

  test('the recovery branch derives evidenceScope/evidenceProvided from ventureEvidence, matching how runCeoCognitiveLifecycle derives them at its own top', async () => {
    const lifecycle = await Bun.file(new URL('../src/lib/ceo-cognitive-lifecycle.ts', import.meta.url)).text()
    expect(lifecycle).toContain("const evidenceScope = request.evidenceScope ?? (ventureEvidence ? 'live_system' : decisionPlan.executionContract.intent === 'self_assessment' ? 'internal_state' : undefined); const evidenceFreshness = request.evidenceFreshness ?? ventureEvidenceFreshness;")
    expect(lifecycle).toContain('evidenceProvided: Boolean(request.contextualEvidence?.trim() || ventureEvidence?.evidence)')
  })

  test('the recovery generation call is given the live venture evidence in its own messages, not just an honest evidenceProvided flag', async () => {
    const lifecycle = await Bun.file(new URL('../src/lib/ceo-cognitive-lifecycle.ts', import.meta.url)).text()
    expect(lifecycle).toContain("const recoveryLiveSystemMessages = ventureEvidence ? [{ role: 'system' as const, content: `LIVE VENTURE STATE (READ ONLY):")
    expect(lifecycle).toContain('const recovery = await runCanonicalLlm({ messages: [...recoveryLiveSystemMessages, ...request.messages]')
  })
})
