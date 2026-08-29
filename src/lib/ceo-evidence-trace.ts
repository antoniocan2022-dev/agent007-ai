import { db } from './db'

export type EvidenceTraceEvent = 'planned' | 'search_started' | 'search_completed' | 'source_accepted' | 'source_rejected' | 'recovery_started' | 'recovery_completed' | 'gate_evaluated' | 'completed' | 'abstained'
export type EvidenceTraceState = 'FULL' | 'PARTIAL' | 'ABSTAIN'

export interface EvidenceTraceEntry { at: number; event: EvidenceTraceEvent; data: Record<string, unknown> }
export interface EvidenceTrace { traceId: string; requestId?: string; objective: string; profile: string; startedAt: number; completedAt?: number; events: EvidenceTraceEntry[]; finalState?: EvidenceTraceState }

function sanitize(value: unknown): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') return value.slice(0, 500)
  if (Array.isArray(value)) return value.slice(0, 20).map(sanitize)
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 20).map(([key, item]) => [key.slice(0, 80), sanitize(item)]))
  return String(value).slice(0, 200)
}

export function startEvidenceTrace(input: { objective: string; profile?: string; requestId?: string }): EvidenceTrace {
  return { traceId: `evidence_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, requestId: input.requestId, objective: input.objective.slice(0, 500), profile: input.profile ?? 'unknown', startedAt: Date.now(), events: [] }
}
export function addEvidenceTraceEvent(trace: EvidenceTrace, event: EvidenceTraceEvent, data: Record<string, unknown> = {}): void {
  trace.events.push({ at: Date.now(), event, data: Object.fromEntries(Object.entries(data).slice(0, 20).map(([key, value]) => [key.slice(0, 80), sanitize(value)])) })
  if (trace.events.length > 100) trace.events.splice(0, trace.events.length - 100)
}
export function completeEvidenceTrace(trace: EvidenceTrace, finalState: EvidenceTraceState): EvidenceTrace {
  if (trace.completedAt) return trace
  trace.completedAt = Date.now()
  trace.finalState = finalState
  console.info('[evidence-trace]', JSON.stringify({ traceId: trace.traceId, requestId: trace.requestId, profile: trace.profile, finalState, eventCount: trace.events.length, durationMs: trace.completedAt - trace.startedAt }))
  if (process.env.NODE_ENV !== 'test' && process.env.CI !== 'true') void persistEvidenceTrace(trace)
  return trace
}

/** Persist the bounded, redacted trace through the existing durable memory store. */
export async function persistEvidenceTrace(trace: EvidenceTrace): Promise<boolean> {
  try {
    const value = JSON.stringify({ traceId: trace.traceId, requestId: trace.requestId, objective: trace.objective, profile: trace.profile, startedAt: trace.startedAt, completedAt: trace.completedAt, finalState: trace.finalState, events: trace.events.map((entry) => ({ at: entry.at, event: entry.event, data: entry.data })) })
    await db.memory.upsert({
      where: { key: `evidence_trace_${trace.traceId}` },
      create: { key: `evidence_trace_${trace.traceId}`, value, category: 'evidence_trace' },
      update: { value, category: 'evidence_trace' },
    })
    return true
  } catch (error) {
    console.warn('[evidence-trace] persistence failed:', error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200))
    return false
  }
}
