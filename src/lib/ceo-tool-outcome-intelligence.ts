export type ToolOutcomeStatus = 'succeeded' | 'partial' | 'failed'

export interface ToolOutcomeObservation {
  toolId: string
  capability: string
  status: ToolOutcomeStatus
  latencyMs?: number
  recordedAt: number
}

export interface ToolOutcomeSnapshot {
  toolId: string
  capability: string
  observations: number
  successRate: number
  avgLatencyMs: number
  reliabilityAdjustment: number
  confidence: number
}

const G = globalThis as any
if (!G.__agent007ToolOutcomeIntelligence) G.__agent007ToolOutcomeIntelligence = new Map<string, ToolOutcomeObservation[]>()
const store: Map<string, ToolOutcomeObservation[]> = G.__agent007ToolOutcomeIntelligence
const MAX_OBSERVATIONS_PER_KEY = 100

function key(toolId: string, capability: string): string {
  return `${toolId}:${capability}`
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

export function recordToolOutcome(observation: Omit<ToolOutcomeObservation, 'recordedAt'>): void {
  const normalized: ToolOutcomeObservation = { ...observation, recordedAt: Date.now() }
  const k = key(observation.toolId, observation.capability)
  const history = store.get(k) ?? []
  history.push(normalized)
  if (history.length > MAX_OBSERVATIONS_PER_KEY) history.splice(0, history.length - MAX_OBSERVATIONS_PER_KEY)
  store.set(k, history)
}

// reliabilityAdjustment is deliberately a small, bounded delta (-0.1 to +0.1), not a replacement
// for the static baseline score -- with few or zero observations it should barely move the score
// at all, avoiding a cold-start problem where a brand-new tool looks unreliable simply because it
// hasn't been used yet. It only becomes a meaningful signal once there's real observation history.
export function getToolOutcomeSnapshot(toolId: string, capability: string): ToolOutcomeSnapshot {
  const history = store.get(key(toolId, capability)) ?? []
  const observations = history.length
  const successes = history.filter((item) => item.status === 'succeeded').length
  const partials = history.filter((item) => item.status === 'partial').length
  const successRate = observations ? (successes * 100 + partials * 50) / observations : 50
  const latencies = history.flatMap((item) => item.latencyMs === undefined ? [] : [item.latencyMs])
  const confidence = observations ? Math.round(Math.min(90, 15 + observations * 6)) : 0
  const reliabilityAdjustment = observations ? Number((((successRate - 50) / 50) * 0.1 * (confidence / 90)).toFixed(4)) : 0
  return { toolId, capability, observations, successRate: Math.round(successRate), avgLatencyMs: Math.round(average(latencies)), reliabilityAdjustment, confidence }
}

export function clearToolOutcomeIntelligenceForTests(): void {
  store.clear()
}
