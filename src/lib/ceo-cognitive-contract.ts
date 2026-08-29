import type { TaskType } from './subagent-governance'
import type { SelfReflectionKind } from './ceo-self-reflection'

export type PreRoute = 'fast' | 'full' | 'ambiguous'
export type CognitivePath = 'fast' | 'full' | 'critical'
export type ReasoningStrategy = 'direct' | 'multi_pass' | 'independent_review'
export type EvidenceState = 'LIVE_EXECUTED' | 'LIVE_VERIFIED' | 'VERIFIED_CACHED' | 'MEMORY_ONLY' | 'PARTIAL_UNCONFIRMED' | 'UNAVAILABLE'
export type QualityDecision = 'PASS' | 'ESCALATE' | 'DEGRADED'
export type VerificationStatus = 'NOT_REQUIRED' | 'NOT_PERFORMED' | 'INDEPENDENT_PASS' | 'FAILED'
export type EvidenceScope = 'none' | 'internal_state' | 'live_system' | 'external_web' | 'mixed'

/** Evidence is the first-class boundary that determines whether a request
 * can be answered from internal state, needs external research, or combines
 * both. This is deliberately deterministic and testable; the LLM never picks
 * the evidence class. */
export type EvidenceClass = 'none' | 'internal_state' | 'external_web' | 'mixed'
export type EvidenceDomain =
  | 'none'
  | 'public_equity'
  | 'general_web'
  | 'market'
  | 'news'
  | 'competitor'
  | 'regulatory'
  | 'business_due_diligence'
  | 'internal_finance'
  | 'internal_operations'
  | 'unknown'
export type EvidenceOperation = 'none' | 'explain' | 'research' | 'compare' | 'analyze' | 'forecast' | 'recommend' | 'decide' | 'verify'
export type TemporalScope = 'none' | 'historical' | 'recent' | 'current' | 'timeless'
export type EvidenceProfile =
  | 'none'
  | 'general_research'
  | 'public_equity'
  | 'market_current'
  | 'news_recent'
  | 'competitor_research'
  | 'business_due_diligence'

export interface EvidenceFreshness {
  observedAt: number
  maxAgeMs: number
}

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
  | 'multi_source'
  | 'subagent'
  | 'mission'
  | 'production'

export type OrchestrationOwner = 'ceo_lifecycle' | 'operational_orchestrator'

export interface CeoExecutionContract {
  intent: CeoIntent
  selfReflectionKind?: SelfReflectionKind
  /** First-class evidence classification used by routing and downstream
   * evidence acquisition. */
  evidenceClass: EvidenceClass
  domain: EvidenceDomain
  operation: EvidenceOperation
  temporalScope: TemporalScope
  evidenceProfile: EvidenceProfile
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
  evidenceScope?: EvidenceScope
  evidenceFreshness?: EvidenceFreshness
  claimScopes?: EvidenceScope[]
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