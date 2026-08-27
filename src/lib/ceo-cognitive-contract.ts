import type { TaskType } from './subagent-governance'

export type PreRoute = 'fast' | 'full' | 'ambiguous'
export type CognitivePath = 'fast' | 'full' | 'critical'
export type ReasoningStrategy = 'direct' | 'multi_pass' | 'independent_review'
export type EvidenceState = 'LIVE_EXECUTED' | 'LIVE_VERIFIED' | 'VERIFIED_CACHED' | 'MEMORY_ONLY' | 'PARTIAL_UNCONFIRMED' | 'UNAVAILABLE'
export type QualityDecision = 'PASS' | 'ESCALATE' | 'DEGRADED'
export type VerificationStatus = 'NOT_REQUIRED' | 'NOT_PERFORMED' | 'INDEPENDENT_PASS' | 'FAILED'

/**
 * Request-level semantic intent. Intent describes what the owner is asking;
 * evidence and execution requirements are derived from intent instead of
 * isolated keyword matches.
 */
export type CeoIntent =
  | 'conversation'
  | 'self_assessment'
  | 'analysis'
  | 'opinion'
  | 'decision'
  | 'research'
  | 'tool_action'
  | 'mission_action'
  | 'production_action'

export type EvidenceRequirement =
  | 'none'
  | 'internal_state'
  | 'memory'
  | 'live_system'
  | 'external_web'
  | 'database'
  | 'multi_source'

export type ExecutionRequirement =
  | 'no_action'
  | 'llm_only'
  | 'one_tool'
  | 'multi_tool'
  | 'subagent'
  | 'mission'
  | 'production'

export type OrchestrationOwner = 'ceo_lifecycle' | 'operational_orchestrator'

export interface CeoExecutionContract {
  intent: CeoIntent
  evidenceRequirement: EvidenceRequirement
  executionRequirement: ExecutionRequirement
  orchestrationOwner: OrchestrationOwner
  maxTurns: number
  maxRecoveries: number
  latencyBudgetMs: number
  toolRequired: boolean
  subagentsRequired: boolean
  reason: string
}

export interface PreRouteDecision {
  route: PreRoute
  reason: string
  missionRelevant: boolean
  complexitySignals: number
  taskClass?: TaskType
  adaptiveExecutionClass?: 'fast' | 'standard' | 'deep' | 'mission'
  executionContract: CeoExecutionContract
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
  executionContract: CeoExecutionContract
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
  verificationStatus: VerificationStatus
  checks: {
    nonEmpty: boolean
    contractValid: boolean
    objectiveCoverage: boolean
    internalConsistency: boolean
    evidenceDiscipline: boolean
    actionableStructure: boolean
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