import type { TaskType } from './subagent-governance'

export type PreRoute = 'fast' | 'full' | 'ambiguous'
export type CognitivePath = 'fast' | 'full' | 'critical'
export type ReasoningStrategy = 'direct' | 'multi_pass' | 'independent_review'
export type EvidenceState = 'LIVE_VERIFIED' | 'VERIFIED_CACHED' | 'MEMORY_ONLY' | 'PARTIAL_UNCONFIRMED' | 'UNAVAILABLE'
export type QualityDecision = 'PASS' | 'ESCALATE' | 'DEGRADED'

export interface PreRouteDecision {
  route: PreRoute
  reason: string
  missionRelevant: boolean
  complexitySignals: number
}

export interface DecisionPlan {
  requestId: string
  path: CognitivePath
  objective: string
  taskClass: TaskType
  missionRelevant: boolean
  requiredCapabilities: string[]
  qualityTier: 'standard' | 'high' | 'critical'
  reasoningStrategy: ReasoningStrategy
  cognitiveDepth: 0 | 1 | 2 | 3 | 4
  verificationRequired: boolean
  maxEscalations: number
  maxProviderAttempts: number
  latencyBudgetMs: number
}

export interface ExecutionStage {
  name: 'primary' | 'refinement' | 'independent_review' | 'synthesis'
  purpose: string
}

export interface ExecutionPlan {
  requestId: string
  path: CognitivePath
  reasoningStrategy: ReasoningStrategy
  stages: ExecutionStage[]
  maxEscalations: number
  maxProviderAttempts: number
}

export interface QualityResult {
  decision: QualityDecision
  evidenceState: EvidenceState
  checks: {
    nonEmpty: boolean
    contractValid: boolean
    objectiveCoverage: boolean
    internalConsistency: boolean
  }
  reasons: string[]
}

export interface CognitiveLifecycleResult {
  content: string
  provider?: string
  model?: string
  responseMs: number
  attempts: string[]
  executionPlan: ExecutionPlan
  decisionPlan: DecisionPlan
  quality: QualityResult
  evidenceState: EvidenceState
  degraded: boolean
}
