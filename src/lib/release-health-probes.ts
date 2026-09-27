import { resolveOrdinalReference } from './ceo-reference-resolution'
import { getGovernedCandidates, type ActiveProviderId } from './provider-control-plane'
import { pickHalfOpenCandidate } from './provider-intelligence'
import type { PersistedConversationRow } from './ceo-context-composer'
import { resolveCeoLane, type PreRouteDecision, type CeoExecutionContract } from './ceo-cognitive-contract'
import { mapProviderErrorKindToCeoFailureReason } from './ceo-failure-reason'
import { classifyMissionStageFailure } from './mission-pipeline-recovery'
import { ProviderControlPlaneError } from './provider-control-plane'

export interface BehavioralProbeResult { name: string; passed: boolean; detail: string }

// Deep-audit recommendation: /api/release-health previously proved deployment identity and that the
// governed-provider runtime can execute a call at all ("Say OK"), but never that any SPECIFIC
// conversational behavior actually works on this exact deployed commit -- the gap between "the pipes are
// connected" and "the water that comes out is correct" is exactly where #112-#115's real production bugs
// lived. These probes are deliberately pure, synchronous, no-network checks (not a full CEO lifecycle
// turn, which would add real LLM cost and multi-second latency to every health poll) -- each one
// exercises the actual fixed function directly, so a future regression in any of them fails this gate
// immediately instead of waiting for the next real incident to surface it. Kept in lib/ (not inline in
// the route) so it stays independently unit-testable without pulling in next/server.
export function verifyBehavioralProbes(): { verified: boolean; probes: BehavioralProbeResult[] } {
  const probes: BehavioralProbeResult[] = []

  // Proves #113: ordinal reference resolution handles markdown-bold-formatted numbered lists, not just
  // bare-digit ones -- the real production bug that forced an unnecessary clarification request when the
  // CEO's own numbered list used standard LLM markdown formatting.
  try {
    const rows: PersistedConversationRow[] = [
      { role: 'user', content: 'Give me two options.', createdAt: Date.now() - 2000 },
      { role: 'assistant', content: '**1. First option**\nDetail one.\n\n**2. Second option**\nDetail two.', createdAt: Date.now() - 1000 },
    ]
    const resolved = resolveOrdinalReference('Explain the second one in more depth.', rows)
    const passed = resolved?.ambiguous === false && Boolean(resolved?.resolvedText?.includes('Second option'))
    probes.push({ name: 'ordinal-reference-markdown-list', passed, detail: passed ? 'resolved correctly against a bold-formatted numbered list' : `resolution did not match expected shape: ${JSON.stringify(resolved)}` })
  } catch (error) {
    probes.push({ name: 'ordinal-reference-markdown-list', passed: false, detail: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200) })
  }

  // Proves #115: the taskType-governance capability table still correctly distinguishes providers that
  // can serve a 'creative' request from ones that can't -- the real production bug where a low attempt
  // budget was wasted entirely on providers structurally incapable of the request's taskType.
  try {
    const creativeIncapable = (['groq', 'cloudflare', 'cerebras'] as ActiveProviderId[]).every((provider) => getGovernedCandidates(provider, 'creative', 'standard').length === 0)
    const creativeCapable = (['mistral', 'openrouter'] as ActiveProviderId[]).every((provider) => getGovernedCandidates(provider, 'creative', 'standard').length > 0)
    const passed = creativeIncapable && creativeCapable
    probes.push({ name: 'taskType-governance-capability-table', passed, detail: passed ? 'creative-incapable and creative-capable providers both correctly classified' : 'governance table classification drifted from the expected shape' })
  } catch (error) {
    probes.push({ name: 'taskType-governance-capability-table', passed: false, detail: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200) })
  }

  // Proves #113: the circuit breaker's half-open primitive is wired and returns a real candidate rather
  // than throwing or returning null for a non-empty input -- the missing state that turned a burst of
  // real transient provider failures into a total, zero-attempt lockout.
  try {
    const picked = pickHalfOpenCandidate(['groq'])
    const passed = picked === 'groq'
    probes.push({ name: 'half-open-candidate-selection', passed, detail: passed ? 'half-open primitive returns a real candidate for a non-empty input' : `unexpected result: ${String(picked)}` })
  } catch (error) {
    probes.push({ name: 'half-open-candidate-selection', passed: false, detail: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200) })
  }

  // "Next architecture" program, Stage 7: proves the three canonical turn lanes -- and the deep-audit
  // fix that keeps a financial/security taskClass turn out of fast_chat even on a fast, tool-free,
  // non-mission route (see resolveCeoLane's own comment) -- still resolve correctly on this exact
  // deployed commit. A regression here silently changes which providers/verification a whole class of
  // live turns gets, with no user-visible error to alert on.
  try {
    const baseContract = (overrides: Partial<CeoExecutionContract> = {}): CeoExecutionContract => ({
      intent: 'conversation', evidenceClass: 'none', domain: 'none', operation: 'none', temporalScope: 'none',
      evidenceProfile: 'none', evidenceRequirement: 'none', executionRequirement: 'llm_only',
      orchestrationOwner: 'ceo_lifecycle', maxTurns: 1, maxRecoveries: 0, latencyBudgetMs: 15000,
      toolRequired: false, subagentsRequired: false, reason: 'release-health probe fixture', ...overrides,
    })
    const baseDecision = (overrides: Partial<PreRouteDecision> = {}): PreRouteDecision => ({
      route: 'fast', reason: 'release-health probe fixture', missionRelevant: false, complexitySignals: 0,
      executionContract: baseContract(), ...overrides,
    })
    const fastChat = resolveCeoLane(baseDecision()) === 'fast_chat'
    const deepCognition = resolveCeoLane(baseDecision({ route: 'full', executionContract: baseContract({ intent: 'analysis' }) })) === 'deep_cognition'
    const durableMission = resolveCeoLane(baseDecision({ missionRelevant: true })) === 'durable_mission'
    const financialStaysDeep = resolveCeoLane(baseDecision({ taskClass: 'financial' })) === 'deep_cognition'
    const passed = fastChat && deepCognition && durableMission && financialStaysDeep
    probes.push({ name: 'ceo-lane-resolution', passed, detail: passed ? 'fast_chat, deep_cognition, durable_mission, and the financial-taskClass exclusion all resolve correctly' : `lane resolution drifted: fastChat=${fastChat} deepCognition=${deepCognition} durableMission=${durableMission} financialStaysDeep=${financialStaysDeep}` })
  } catch (error) {
    probes.push({ name: 'ceo-lane-resolution', passed: false, detail: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200) })
  }

  // "Next architecture" program, Stage 7: proves the Stage 4 provider-to-CEO failure bridge still maps
  // a real production incident shape (BILLING) and a genuine transient class (TIMEOUT) to the right
  // CEO-layer reason -- the exact distinction the old message-regex fallback could not make.
  try {
    const billing = mapProviderErrorKindToCeoFailureReason('BILLING') === 'provider_unavailable'
    const timeout = mapProviderErrorKindToCeoFailureReason('TIMEOUT') === 'provider_timeout'
    const passed = billing && timeout
    probes.push({ name: 'provider-failure-taxonomy-bridge', passed, detail: passed ? 'BILLING and TIMEOUT both map to their expected CEO failure reason' : `mapping drifted: billing=${billing} timeout=${timeout}` })
  } catch (error) {
    probes.push({ name: 'provider-failure-taxonomy-bridge', passed: false, detail: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200) })
  }

  // "Next architecture" program, Stage 7: proves mission-pipeline.ts's Stage 5 auto-retry classifier
  // still distinguishes a transient provider failure (safe to auto-retry) from a generic/unknown error
  // (must stay fatal) -- getting this backwards would either strand a healthy mission on a permanent
  // failure, or retry a genuinely broken one forever.
  try {
    const transientRetryable = classifyMissionStageFailure(new ProviderControlPlaneError({ provider: 'groq', kind: 'TIMEOUT', message: 'probe fixture', retryable: true })).retryable === true
    const genericFatal = classifyMissionStageFailure(new Error('probe fixture: unexpected programming error')).retryable === false
    const passed = transientRetryable && genericFatal
    probes.push({ name: 'mission-auto-retry-classification', passed, detail: passed ? 'transient provider failures classify retryable; generic errors classify fatal' : `classification drifted: transientRetryable=${transientRetryable} genericFatal=${genericFatal}` })
  } catch (error) {
    probes.push({ name: 'mission-auto-retry-classification', passed: false, detail: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200) })
  }

  return { verified: probes.every((probe) => probe.passed), probes }
}
