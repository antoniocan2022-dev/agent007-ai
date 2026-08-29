export type EvidenceTraceEvent = 'planned' | 'search_started' | 'search_completed' | 'source_accepted' | 'source_rejected' | 'recovery_started' | 'recovery_completed' | 'gate_evaluated' | 'completed' | 'abstained'

export interface EvidenceTraceEntry { at: number; event: EvidenceTraceEvent; data: Record<string, unknown> }
export interface EvidenceTrace { traceId: string; requestId?: string; objective: string; profile: string; startedAt: number; completedAt?: number; events: EvidenceTraceEntry[]; finalState?: 'FULL' | 'PARTIAL' | 'ABSTAIN' }

export function startEvidenceTrace(input: { objective: string; profile?: string; requestId?: string }): EvidenceTrace {
  return { traceId: `evidence_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, requestId: input.requestId, objective: input.objective.slice(0, 500), profile: input.profile ?? 'unknown', startedAt: Date.now(), events: [] }
}
export function addEvidenceTraceEvent(trace: EvidenceTrace, event: EvidenceTraceEvent, data: Record<string, unknown> = {}): void {
  trace.events.push({ at: Date.now(), event, data: Object.fromEntries(Object.entries(data).slice(0, 20)) })
  if (trace.events.length > 100) trace.events.splice(0, trace.events.length - 100)
}
export function completeEvidenceTrace(trace: EvidenceTrace, finalState: EvidenceTrace['finalState']): EvidenceTrace {
  trace.completedAt = Date.now(); trace.finalState = finalState
  // Structured, low-volume telemetry; never contains raw source text or secrets.
  console.info('[evidence-trace]', JSON.stringify({ traceId: trace.traceId, requestId: trace.requestId, profile: trace.profile, finalState, eventCount: trace.events.length, durationMs: trace.completedAt - trace.startedAt }))
  return trace
}