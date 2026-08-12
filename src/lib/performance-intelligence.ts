import type { ProviderId, TaskType } from './subagent-governance'
import { getModelProfile } from './model-intelligence'

export interface PerformanceObservation {
  provider: ProviderId
  model: string
  taskType: TaskType
  success: boolean
  responseMs: number
  recordedAt: number
}

export interface PerformanceSnapshot {
  provider: ProviderId
  model: string
  taskType: TaskType
  calls: number
  successes: number
  failures: number
  successRate: number
  avgResponseMs: number
  score: number
}

export interface PerformanceRecommendation extends PerformanceSnapshot {
  confidence: number
  reason: string
}

const G = globalThis as any
if (!G.__agent007Performance) G.__agent007Performance = new Map<string, PerformanceObservation[]>()
const store: Map<string, PerformanceObservation[]> = G.__agent007Performance
const MAX_OBSERVATIONS_PER_KEY = 100

function key(provider: ProviderId, model: string, taskType: TaskType): string {
  return `${provider}:${model}:${taskType}`
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function recordModelPerformance(observation: Omit<PerformanceObservation, 'recordedAt'>): void {
  const k = key(observation.provider, observation.model, observation.taskType)
  const history = store.get(k) ?? []
  history.push({ ...observation, recordedAt: Date.now() })
  if (history.length > MAX_OBSERVATIONS_PER_KEY) history.splice(0, history.length - MAX_OBSERVATIONS_PER_KEY)
  store.set(k, history)
}

export function getPerformanceSnapshot(provider: ProviderId, model: string, taskType: TaskType): PerformanceSnapshot {
  const history = store.get(key(provider, model, taskType)) ?? []
  const calls = history.length
  const successes = history.filter((item) => item.success).length
  const failures = calls - successes
  const successRate = calls ? successes / calls * 100 : 0
  const avgResponseMs = calls ? Math.round(history.reduce((sum, item) => sum + item.responseMs, 0) / calls) : 0
  const profile = getModelProfile(provider, model)
  const priorQuality = profile?.quality ?? 50
  const priorSpeed = profile?.speed ?? 50
  const observedSpeed = avgResponseMs > 0 ? clamp(100 - Math.max(0, avgResponseMs - 500) / 45, 0, 100) : priorSpeed
  const reliability = calls ? successRate : priorQuality
  const score = Math.round(reliability * 0.5 + observedSpeed * 0.2 + priorQuality * 0.2 + priorSpeed * 0.1)

  return { provider, model, taskType, calls, successes, failures, successRate: Math.round(successRate), avgResponseMs, score }
}

/**
 * Produces recommendations without changing governance priority. The caller
 * may use this for model selection within an already-authorized provider.
 * Confidence grows with observations but remains capped at 95%.
 */
export function recommendModelsForTask(taskType: TaskType, providers: readonly ProviderId[]): PerformanceRecommendation[] {
  const recommendations: PerformanceRecommendation[] = []
  for (const provider of providers) {
    for (const observation of getKnownModels(provider, taskType)) {
      const snapshot = getPerformanceSnapshot(provider, observation.model, taskType)
      const confidence = Math.round(Math.min(95, 25 + snapshot.calls * 5))
      const reason = snapshot.calls === 0
        ? 'Cold start: using governed model priors until runtime evidence is available.'
        : `${snapshot.successRate}% observed success across ${snapshot.calls} calls; ${snapshot.avgResponseMs}ms average latency.`
      recommendations.push({ ...snapshot, confidence, reason })
    }
  }
  return recommendations.sort((a, b) => b.score - a.score)
}

function getKnownModels(provider: ProviderId, taskType: TaskType): Array<{ model: string }> {
  const candidates = new Set<string>()
  const profile = getModelProfile(provider, '')
  if (profile) candidates.add(profile.model)
  for (const k of store.keys()) {
    const [candidateProvider, candidateModel, candidateTask] = k.split(':')
    if (candidateProvider === provider && candidateTask === taskType) candidates.add(candidateModel)
  }
  return [...candidates].map((model) => ({ model }))
}

export function getPerformanceSummary(taskType?: TaskType): PerformanceRecommendation[] {
  const keys = [...store.keys()]
  const seen = new Set<string>()
  const output: PerformanceRecommendation[] = []
  for (const k of keys) {
    const [provider, model, task] = k.split(':') as [ProviderId, string, TaskType]
    if (taskType && task !== taskType) continue
    const id = `${provider}:${model}:${task}`
    if (seen.has(id)) continue
    seen.add(id)
    const snapshot = getPerformanceSnapshot(provider, model, task)
    output.push({
      ...snapshot,
      confidence: Math.round(Math.min(95, 25 + snapshot.calls * 5)),
      reason: `${snapshot.successRate}% observed success across ${snapshot.calls} calls; ${snapshot.avgResponseMs}ms average latency.`,
    })
  }
  return output.sort((a, b) => b.score - a.score)
}
