/**
 * Stage 0 of the "next architecture" program: real, per-stage timing for a single CEO turn.
 *
 * Deliberately additive and observation-only -- creating/populating this object changes no request
 * behavior. Every field is measured at a real call boundary in route.ts; nothing here is estimated
 * or backfilled. `cognitiveLifecycleMs` is intentionally one aggregate span (generation + quality
 * gate + repair combined) rather than four separately-timed sub-stages: subdividing it means
 * instrumenting return points scattered throughout ceo-cognitive-lifecycle.ts's escalation/repair
 * control flow, which is exactly the kind of invasive change this stage is meant to avoid. That
 * finer breakdown is a natural byproduct of Stage 4 (the shared CeoFailureClass repair taxonomy),
 * which already has to touch that file's repair paths carefully -- adding it now, separately, would
 * just mean touching the same sensitive code twice.
 */

export interface CeoTurnTelemetry {
  /** Canonical Stage-1 turn lane (see resolveCeoLane in ceo-cognitive-contract.ts), or 'unknown' before it's resolved. */
  lane: 'fast_chat' | 'deep_cognition' | 'durable_mission' | 'unknown'
  // Per-stage wall time, in milliseconds. Each is the sum of every call through that stage this
  // turn (e.g. contextComposeMs accumulates across all composeCeoContext calls in the turn, since
  // route.ts calls it more than once).
  authMs: number
  conversationLoadMs: number
  objectiveLoadMs: number
  contextComposeMs: number
  semanticInterpretationMs: number
  decisionMs: number
  groundingMs: number
  knowledgeMs: number
  evidenceMs: number
  cognitiveLifecycleMs: number
  persistenceMs: number
  /** Wall time for the whole request, start of POST to the moment telemetry is logged. Not a sum
   *  of the fields above (there's uninstrumented time between stages) -- a sanity-check upper bound. */
  totalMs: number

  // Counts, each read directly off data route.ts already has at hand -- no new instrumentation
  // elsewhere in the pipeline.
  conversationRowsLoaded: number
  messagesInContext: number
  evidenceSourceCount: number
  providerAttemptCount: number
  escalationCount: number
  repairPathEntered: boolean
  degraded: boolean
}

type CeoTurnTimingField = 'authMs' | 'conversationLoadMs' | 'objectiveLoadMs' | 'contextComposeMs' | 'semanticInterpretationMs' | 'decisionMs' | 'groundingMs' | 'knowledgeMs' | 'evidenceMs' | 'cognitiveLifecycleMs' | 'persistenceMs'

export function createCeoTurnTelemetry(): CeoTurnTelemetry {
  return {
    lane: 'unknown',
    authMs: 0, conversationLoadMs: 0, objectiveLoadMs: 0, contextComposeMs: 0, semanticInterpretationMs: 0,
    decisionMs: 0, groundingMs: 0, knowledgeMs: 0, evidenceMs: 0, cognitiveLifecycleMs: 0, persistenceMs: 0, totalMs: 0,
    conversationRowsLoaded: 0, messagesInContext: 0, evidenceSourceCount: 0, providerAttemptCount: 0,
    escalationCount: 0, repairPathEntered: false, degraded: false,
  }
}

/**
 * Times an async call and adds the elapsed milliseconds to `telemetry[field]`, then returns
 * whatever the call returned (or rethrows whatever it threw) unchanged -- a pure try/finally
 * wrapper. `telemetry` is optional so call sites that don't have one (tests, offline tooling) pay
 * no cost and need no branching.
 */
export async function timeCeoTurnStage<T>(telemetry: CeoTurnTelemetry | undefined, field: CeoTurnTimingField, fn: () => Promise<T>): Promise<T> {
  if (!telemetry) return fn()
  const startedAt = Date.now()
  try {
    return await fn()
  } finally {
    telemetry[field] += Date.now() - startedAt
  }
}

/** Synchronous counterpart of {@link timeCeoTurnStage} for non-async stages (pre-routing, decision-plan construction). */
export function timeCeoTurnStageSync<T>(telemetry: CeoTurnTelemetry | undefined, field: CeoTurnTimingField, fn: () => T): T {
  if (!telemetry) return fn()
  const startedAt = Date.now()
  try {
    return fn()
  } finally {
    telemetry[field] += Date.now() - startedAt
  }
}

export function logCeoTurnTelemetry(telemetry: CeoTurnTelemetry, requestId: string): void {
  console.log('[ceo-turn-telemetry]', JSON.stringify({ requestId, ...telemetry }))
}
