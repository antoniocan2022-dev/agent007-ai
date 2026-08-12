import type { ProviderId, TaskType } from './subagent-governance'
import { getPerformanceSnapshot } from './performance-intelligence'

export type OutcomeStatus = 'verified_success' | 'partial' | 'failed' | 'unknown'

export interface OutcomeObservation {
  provider: ProviderId
  model: string
  taskType: TaskType
  status: OutcomeStatus
  qualityScore?: number
  businessValueScore?: number
  verificationPassed: boolean
  recordedAt: number
}

export interface OutcomeSnapshot {
  provider: ProviderId
  model: string
  taskType: TaskType
  observations: number
  verifiedSuccesses: number
  partials: number
  failures: number
  verificationRate: number
  avgQualityScore: number
  avgBusinessValueScore: number
  outcomeScore: number
  confidence: number
}

const G = globalThis as any
if (!G.__agent007OutcomeIntelligence) G.__agent007OutcomeIntelligence = new Map<string, OutcomeObservation[]>()
const store: Map<string, OutcomeObservation[]> = G.__agent007OutcomeIntelligence
const MAX_OBSERVATIONS_PER_KEY = 100

function key(provider: ProviderId, model: string, taskType: TaskType): string {
  return `${provider}:${model}:${taskType}`
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value))
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

export function recordModelOutcome(observation: Omit<OutcomeObservation, 'recordedAt'>): void {
  const qualityScore = observation.qualityScore === undefined ? undefined : clamp(observation.qualityScore)
  const businessValueScore = observation.businessValueScore === undefined ? undefined : clamp(observation.businessValueScore)
  const normalized: OutcomeObservation = { ...observation, qualityScore, businessValueScore, recordedAt: Date.now() }
  const history = store.get(key(observation.provider, observation.model, observation.taskType)) ?? []
  history.push(normalized)
  if (history.length > MAX_OBSERVATIONS_PER_KEY) history.splice(0, history.length - MAX_OBSERVATIONS_PER_KEY)
  store.set(key(observation.provider, observation.model, observation.taskType), history)
}

export function getOutcomeSnapshot(provider: ProviderId, model: string, taskType: TaskType): OutcomeSnapshot {
  const history = store.get(key(provider, model, taskType)) ?? []
  const observations = history.length
  const verifiedSuccesses = history.filter((item) => item.status === 'verified_success').length
  const partials = history.filter((item) => item.status === 'partial').length
  const failures = history.filter((item) => item.status === 'failed').length
  const verificationRate = observations ? history.filter((item) => item.verificationPassed).length / observations * 100 : 0
  const qualityValues = history.flatMap((item) => item.qualityScore === undefined ? [] : [item.qualityScore])
  const businessValues = history.flatMap((item) => item.businessValueScore === undefined ? [] : [item.businessValueScore])
  const quality = average(qualityValues)
  const businessValue = average(businessValues)

  const observedOutcome = observations
    ? (verifiedSuccesses * 100 + partials * 60 + failures * 0) / observations
    : getPerformanceSnapshot(provider, model, taskType).score
  const qualityComponent = qualityValues.length ? quality : observedOutcome
  const businessComponent = businessValues.length ? businessValue : observedOutcome
  const verificationComponent = observations ? verificationRate : 50
  const outcomeScore = Math.round(
    clamp(observedOutcome) * 0.45 +
    clamp(qualityComponent) * 0.25 +
    clamp(businessComponent) * 0.20 +
    clamp(verificationComponent) * 0.10,
  )
  const confidence = observations ? Math.round(Math.min(95, 20 + observations * 7)) : 15

  return {
    provider, model, taskType, observations, verifiedSuccesses, partials,
    failures, verificationRate: Math.round(verificationRate),
    avgQualityScore: Math.round(quality), avgBusinessValueScore: Math.round(businessValue),
    outcomeScore, confidence,
  }
}

export function recommendByVerifiedOutcome(
  taskType: TaskType,
  candidates: readonly { provider: ProviderId; model: string }[],
): OutcomeSnapshot[] {
  return candidates
    .map(({ provider, model }) => getOutcomeSnapshot(provider, model, taskType))
    .sort((a, b) => b.outcomeScore - a.outcomeScore)
}

export function clearOutcomeIntelligenceForTests(): void {
  store.clear()
}
