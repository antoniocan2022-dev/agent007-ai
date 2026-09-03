/**
 * Canonical architecture-integrity contract.
 *
 * This extends the existing Architecture Control Plane. It is deliberately
 * metadata-first and does not introduce another tool/capability registry.
 * The ledger is the authoritative architecture map for ownership, reachability,
 * contracts, evidence, verification, outcomes, learning, evolution and the
 * continuous-loop governance surface.
 */

export type ArchitectureLifecycleState = 'DISCOVERED' | 'CANONICAL' | 'INTEGRATED' | 'OBSERVED' | 'PROVEN'
export type IntegrationStatus = 'MISSING' | 'PARTIAL' | 'INTEGRATED' | 'PROVEN'
export type RiskClass = 'LOW' | 'HIGH'
export type EvidencePolicy = 'NONE' | 'REQUIRED' | 'DECISION_GRADE'

export interface CanonicalCapabilityLedgerEntry {
  capability: string
  subsystem: string
  canonicalOwner: string
  domain: string
  purpose: string
  runtimeEntryPoints: string[]
  orchestrationOwners: string[]
  consumers: string[]
  tools: string[]
  requiredContracts: string[]
  producedEvidence: string[]
  verificationMethod: string
  integrationProof: string
  tests: string[]
  ciGates: string[]
  integrationStatus: IntegrationStatus
  productionObserved: boolean
  duplicateRisk: 'LOW' | 'MEDIUM' | 'HIGH'
  lifecycleState: ArchitectureLifecycleState
}

export interface IntegrationContract {
  capability: string
  canonicalOwner: string
  entryPoint: string
  inputContract: string
  outputContract: string
  verificationContract: string
  outcomeContract: string
  failClosed: boolean
}

export type LoopStage =
  | 'PERCEIVE'
  | 'UNDERSTAND'
  | 'REMEMBER'
  | 'THINK'
  | 'CURIOUS'
  | 'WORLD_CHECK'
  | 'DECIDE'
  | 'PROTECT'
  | 'OPERATE'
  | 'VERIFY'
  | 'MEASURE_OUTCOME'
  | 'REFLECT'
  | 'LEARN'
  | 'VALIDATE'
  | 'ADAPT'
  | 'EVOLVE'
  | 'REGRESSION_TEST'
  | 'CONTINUE'

export interface LoopTransitionContract {
  from: LoopStage
  to: LoopStage
  inputContract: string
  outputContract: string
  proofRequirement: string
  failClosed: boolean
}

const CEO_RUNTIME = 'src/app/api/agent/route.ts'
const CEO_LIFECYCLE = 'src/lib/ceo-cognitive-lifecycle.ts'
const BASELINE_TEST = 'tests/architecture-integrity-contract.test.ts'
const CONTROL_PLANE_TEST = 'tests/architecture-control-plane.test.ts'
const CI_WORKFLOW = '.github/workflows/architecture-control-plane-verification.yml'
const PHASE58_TEST = 'tests/continuous-loop-integrity.test.ts'

export const CANONICAL_CAPABILITY_LEDGER: Readonly<Record<string, CanonicalCapabilityLedgerEntry>> = Object.freeze({
  semantic_interpretation: { capability: 'semantic_interpretation', subsystem: 'CEO semantic layer', canonicalOwner: 'ceo-semantic-interpreter', domain: 'CEO', purpose: 'Resolve meaning before routing.', runtimeEntryPoints: [CEO_RUNTIME], orchestrationOwners: ['ceo_lifecycle'], consumers: ['ceo-pre-router', 'ceo-cognitive-lifecycle'], tools: [], requiredContracts: ['canonical conversation context'], producedEvidence: ['semantic interpretation'], verificationMethod: 'semantic regression tests', integrationProof: 'CEO route invokes interpreter before pre-routing', tests: ['tests/ceo-personality-and-resilience.test.ts'], ciGates: [CI_WORKFLOW], integrationStatus: 'INTEGRATED', productionObserved: false, duplicateRisk: 'LOW', lifecycleState: 'INTEGRATED' },
  decision_contract: { capability: 'decision_contract', subsystem: 'CEO judgment/decision layer', canonicalOwner: 'ceo-conversation-decision-contract', domain: 'CEO', purpose: 'Authoritatively define intent, response action and evidence requirements.', runtimeEntryPoints: [CEO_RUNTIME], orchestrationOwners: ['ceo_lifecycle'], consumers: ['ceo-cognitive-lifecycle', 'ceo-pre-router'], tools: [], requiredContracts: ['canonical conversation context'], producedEvidence: ['intent', 'response action', 'evidence requirement'], verificationMethod: 'contract regression tests', integrationProof: 'Route builds contract and passes it into lifecycle', tests: [BASELINE_TEST], ciGates: [CI_WORKFLOW], integrationStatus: 'INTEGRATED', productionObserved: false, duplicateRisk: 'LOW', lifecycleState: 'INTEGRATED' },
  world_model: { capability: 'world_model', subsystem: 'CEO world model', canonicalOwner: 'ceo-world-model', domain: 'CEO', purpose: 'Maintain structured internal state from conversation, system and external evidence.', runtimeEntryPoints: [CEO_LIFECYCLE], orchestrationOwners: ['ceo_lifecycle'], consumers: ['ceo-cognitive-lifecycle'], tools: [], requiredContracts: ['canonical conversation context', 'persisted conversation'], producedEvidence: ['world snapshot', 'system state', 'external evidence state'], verificationMethod: 'world-model context propagation tests', integrationProof: 'Lifecycle builds world model from canonical context and persisted history', tests: ['tests/ceo-lifecycle-context-propagation.test.ts'], ciGates: [CI_WORKFLOW], integrationStatus: 'INTEGRATED', productionObserved: false, duplicateRisk: 'LOW', lifecycleState: 'INTEGRATED' },
  cognitive_judgment: { capability: 'cognitive_judgment', subsystem: 'CEO cognitive kernel', canonicalOwner: 'ceo-cognitive-kernel', domain: 'CEO', purpose: 'Turn the decision contract into governed reasoning depth, capabilities and verification requirements.', runtimeEntryPoints: [CEO_LIFECYCLE], orchestrationOwners: ['ceo_lifecycle'], consumers: ['ceo-cognitive-lifecycle'], tools: [], requiredContracts: ['pre-route decision', 'execution contract'], producedEvidence: ['decision plan', 'reasoning strategy', 'required capabilities'], verificationMethod: 'cognitive kernel tests', integrationProof: 'Lifecycle constructs decision plan before execution', tests: [BASELINE_TEST], ciGates: [CI_WORKFLOW], integrationStatus: 'INTEGRATED', productionObserved: false, duplicateRisk: 'LOW', lifecycleState: 'INTEGRATED' },
  capability_architecture: { capability: 'capability_architecture', subsystem: 'Enterprise capability architecture', canonicalOwner: 'ceo-capability-architecture', domain: 'CEO', purpose: 'Map decisions to enterprise capabilities before selecting tools.', runtimeEntryPoints: ['src/lib/ceo-cognitive-kernel.ts'], orchestrationOwners: ['ceo_lifecycle', 'operational_orchestrator'], consumers: ['ceo-cognitive-kernel', 'ceo-tool-selection'], tools: [], requiredContracts: ['decision plan'], producedEvidence: ['required capabilities'], verificationMethod: 'capability mapping tests', integrationProof: 'Decision planner consumes capabilitiesForDecision()', tests: [BASELINE_TEST], ciGates: [CI_WORKFLOW], integrationStatus: 'INTEGRATED', productionObserved: false, duplicateRisk: 'MEDIUM', lifecycleState: 'INTEGRATED' },
  tool_selection: { capability: 'tool_selection', subsystem: 'Governed tool selection', canonicalOwner: 'ceo-tool-selection', domain: 'Execution', purpose: 'Choose tools using relevance, reliability, freshness, latency, cost, permissions and observed outcomes.', runtimeEntryPoints: ['src/lib/ceo-evidence-planner.ts', CEO_LIFECYCLE], orchestrationOwners: ['ceo_lifecycle', 'operational_orchestrator'], consumers: ['ceo-evidence-planner', 'orchestrator'], tools: ['tool registry'], requiredContracts: ['ceo execution contract'], producedEvidence: ['tool selection score', 'execution strategy'], verificationMethod: 'tool-selection regression tests', integrationProof: 'Evidence planner requests selectCeoTool()', tests: [BASELINE_TEST], ciGates: [CI_WORKFLOW], integrationStatus: 'INTEGRATED', productionObserved: false, duplicateRisk: 'MEDIUM', lifecycleState: 'INTEGRATED' },
  evidence_acquisition: { capability: 'evidence_acquisition', subsystem: 'External evidence pipeline', canonicalOwner: 'ceo-evidence-planner + ceo-evidence-executor', domain: 'Evidence', purpose: 'Acquire fresh external evidence under a governed plan.', runtimeEntryPoints: [CEO_RUNTIME], orchestrationOwners: ['ceo_lifecycle'], consumers: ['ceo-cognitive-lifecycle'], tools: ['web_search', 'page_reader', 'SEC Company Facts'], requiredContracts: ['external evidence plan', 'evidence bundle'], producedEvidence: ['evidence bundle', 'provenance', 'freshness', 'source tiers'], verificationMethod: 'decision-grade evidence gate', integrationProof: 'Route plans, executes, recovers and traces evidence before lifecycle synthesis', tests: [BASELINE_TEST, 'tests/ceo-lifecycle-context-propagation.test.ts'], ciGates: [CI_WORKFLOW], integrationStatus: 'INTEGRATED', productionObserved: false, duplicateRisk: 'LOW', lifecycleState: 'INTEGRATED' },
  evidence_verification: { capability: 'evidence_verification', subsystem: 'Evidence/claim verification', canonicalOwner: 'ceo-claim-evidence-gate', domain: 'Evidence', purpose: 'Map answer claims to acquired sources and distinguish verified from unsupported claims.', runtimeEntryPoints: [CEO_RUNTIME], orchestrationOwners: ['ceo_lifecycle'], consumers: ['ceo-claim-evidence-gate'], tools: ['evidence bundle'], requiredContracts: ['response content', 'evidence bundle'], producedEvidence: ['claim verification result'], verificationMethod: 'claim-evidence regression tests', integrationProof: 'Route evaluates final response claims against the bundle', tests: [BASELINE_TEST], ciGates: [CI_WORKFLOW], integrationStatus: 'INTEGRATED', productionObserved: false, duplicateRisk: 'LOW', lifecycleState: 'INTEGRATED' },
  response_quality: { capability: 'response_quality', subsystem: 'CEO response quality gate', canonicalOwner: 'ceo-response-quality-gate', domain: 'CEO', purpose: 'Reject incomplete, contradictory, poorly grounded or low-quality answers.', runtimeEntryPoints: [CEO_LIFECYCLE], orchestrationOwners: ['ceo_lifecycle'], consumers: ['ceo-cognitive-lifecycle'], tools: [], requiredContracts: ['candidate response', 'decision plan', 'evidence state'], producedEvidence: ['quality decision', 'quality reasons'], verificationMethod: 'quality-gate regression suite', integrationProof: 'Every lifecycle output passes evaluateCeoQuality()', tests: [BASELINE_TEST], ciGates: [CI_WORKFLOW], integrationStatus: 'INTEGRATED', productionObserved: false, duplicateRisk: 'LOW', lifecycleState: 'INTEGRATED' },
  outcome_tracking: { capability: 'outcome_tracking', subsystem: 'Recommendation/outcome correlation', canonicalOwner: 'ceo-outcome-learning + architecture-control-plane', domain: 'Learning', purpose: 'Record recommendation identity, action, predicted outcome and observed result.', runtimeEntryPoints: [CEO_RUNTIME, 'src/app/api/architecture/business-outcome/route.ts'], orchestrationOwners: ['ceo_lifecycle', 'operational_orchestrator'], consumers: ['ceo-outcome-learning', 'closed-loop-improvement'], tools: [], requiredContracts: ['recommendation record', 'action record', 'business outcome'], producedEvidence: ['recommendation', 'prediction', 'action', 'outcome', 'prediction error'], verificationMethod: 'outcome identity/idempotency regression tests', integrationProof: 'Recommendation and outcome share a canonical correlation identity', tests: [PHASE58_TEST, CONTROL_PLANE_TEST], ciGates: [CI_WORKFLOW], integrationStatus: 'INTEGRATED', productionObserved: false, duplicateRisk: 'MEDIUM', lifecycleState: 'INTEGRATED' },
  behavioral_learning: { capability: 'behavioral_learning', subsystem: 'Governed behavioral learning', canonicalOwner: 'ceo-behavioral-learning', domain: 'Learning', purpose: 'Turn verified behavior/outcome error into reviewable learning candidates without silently changing runtime behavior.', runtimeEntryPoints: [CEO_RUNTIME, 'src/lib/closed-loop-improvement.ts'], orchestrationOwners: ['ceo_lifecycle', 'operational_orchestrator'], consumers: ['ceo-behavioral-learning', 'evolution-engine'], tools: [], requiredContracts: ['behavior record', 'outcome correlation', 'validation decision'], producedEvidence: ['learning candidate', 'validation record', 'promotion record'], verificationMethod: 'learning lifecycle tests', integrationProof: 'Learning candidate cannot be promoted without explicit approval and regression coverage', tests: [PHASE58_TEST], ciGates: [CI_WORKFLOW], integrationStatus: 'INTEGRATED', productionObserved: false, duplicateRisk: 'LOW', lifecycleState: 'INTEGRATED' },
  governed_evolution: { capability: 'governed_evolution', subsystem: 'Evolution engine', canonicalOwner: 'evolution-engine', domain: 'Evolution', purpose: 'Observe, diagnose, propose, simulate, approve, apply, verify, compare and keep/rollback improvements.', runtimeEntryPoints: ['src/lib/evolution-engine.ts', 'src/lib/closed-loop-improvement.ts', 'src/app/api/system/evolution/route.ts'], orchestrationOwners: ['operational_orchestrator'], consumers: ['closed-loop-improvement', 'ceo-continuous-loop'], tools: [], requiredContracts: ['evolution proposal', 'simulation', 'approval', 'verification'], producedEvidence: ['baseline', 'simulation', 'approval', 'verification', 'keep/rollback decision'], verificationMethod: 'governed evolution regression tests', integrationProof: 'Evolution proposals are simulated and verified against baseline before keep/rollback', tests: [PHASE58_TEST, CONTROL_PLANE_TEST], ciGates: [CI_WORKFLOW], integrationStatus: 'PARTIAL', productionObserved: false, duplicateRisk: 'LOW', lifecycleState: 'INTEGRATED' },
  degraded_recovery: { capability: 'degraded_recovery', subsystem: 'CEO degraded/recovery mode', canonicalOwner: 'ceo-degraded-mode', domain: 'Recovery', purpose: 'Recover safely from provider/tool/context failures without making false claims.', runtimeEntryPoints: [CEO_LIFECYCLE], orchestrationOwners: ['ceo_lifecycle'], consumers: ['ceo-cognitive-lifecycle'], tools: ['persistent-memory'], requiredContracts: ['failure reason', 'response action', 'risk class'], producedEvidence: ['failure classification', 'recovery capability', 'abstention state'], verificationMethod: 'risk-aware recovery regression tests', integrationProof: 'High-risk recovery fails closed instead of using memory as substitute evidence', tests: [BASELINE_TEST, PHASE58_TEST], ciGates: [CI_WORKFLOW], integrationStatus: 'INTEGRATED', productionObserved: false, duplicateRisk: 'LOW', lifecycleState: 'INTEGRATED' },
  continuous_loop: { capability: 'continuous_loop', subsystem: 'Canonical CEO continuous improvement loop', canonicalOwner: 'ceo-continuous-loop', domain: 'CEO', purpose: 'Enforce authoritative transitions from decision through verification, outcome measurement, learning and governed evolution.', runtimeEntryPoints: [CEO_RUNTIME, CEO_LIFECYCLE], orchestrationOwners: ['ceo_lifecycle', 'operational_orchestrator'], consumers: ['ceo-cognitive-lifecycle', 'evolution-engine'], tools: [], requiredContracts: ['loop transition contract', 'outcome contract', 'learning contract', 'evolution contract'], producedEvidence: ['stage transition record', 'loop completion record'], verificationMethod: 'continuous-loop integrity tests', integrationProof: 'Each transition is validated before the next stage can execute', tests: [PHASE58_TEST], ciGates: [CI_WORKFLOW], integrationStatus: 'INTEGRATED', productionObserved: false, duplicateRisk: 'LOW', lifecycleState: 'INTEGRATED' },
})

export const LOOP_TRANSITIONS: readonly LoopTransitionContract[] = Object.freeze([
  { from: 'PERCEIVE', to: 'UNDERSTAND', inputContract: 'user/request', outputContract: 'canonical context', proofRequirement: 'semantic context exists', failClosed: false },
  { from: 'UNDERSTAND', to: 'REMEMBER', inputContract: 'canonical context', outputContract: 'relevant memory context', proofRequirement: 'memory lookup attempted when applicable', failClosed: false },
  { from: 'REMEMBER', to: 'THINK', inputContract: 'context + memory', outputContract: 'decision plan', proofRequirement: 'canonical decision contract exists', failClosed: true },
  { from: 'THINK', to: 'CURIOUS', inputContract: 'decision plan', outputContract: 'curiosity assessment', proofRequirement: 'external uncertainty evaluated', failClosed: false },
  { from: 'CURIOUS', to: 'WORLD_CHECK', inputContract: 'curiosity assessment', outputContract: 'evidence plan when needed', proofRequirement: 'external check only when warranted', failClosed: false },
  { from: 'WORLD_CHECK', to: 'DECIDE', inputContract: 'evidence state', outputContract: 'decision', proofRequirement: 'evidence requirement satisfied or abstention', failClosed: true },
  { from: 'DECIDE', to: 'PROTECT', inputContract: 'decision', outputContract: 'guardian constraints', proofRequirement: 'risk class evaluated', failClosed: true },
  { from: 'PROTECT', to: 'OPERATE', inputContract: 'protected decision', outputContract: 'execution plan', proofRequirement: 'authorization contract satisfied', failClosed: true },
  { from: 'OPERATE', to: 'VERIFY', inputContract: 'execution result', outputContract: 'verification result', proofRequirement: 'observable completion checked', failClosed: true },
  { from: 'VERIFY', to: 'MEASURE_OUTCOME', inputContract: 'verification result', outputContract: 'outcome measurement', proofRequirement: 'outcome source identified', failClosed: false },
  { from: 'MEASURE_OUTCOME', to: 'REFLECT', inputContract: 'actual outcome', outputContract: 'reflection', proofRequirement: 'actual result separated from prediction', failClosed: false },
  { from: 'REFLECT', to: 'LEARN', inputContract: 'reflection + error', outputContract: 'learning candidate', proofRequirement: 'root cause stated', failClosed: false },
  { from: 'LEARN', to: 'VALIDATE', inputContract: 'learning candidate', outputContract: 'validation record', proofRequirement: 'validation test/evidence exists', failClosed: true },
  { from: 'VALIDATE', to: 'ADAPT', inputContract: 'validated learning', outputContract: 'approved adaptation', proofRequirement: 'approval is explicit for behavioral changes', failClosed: true },
  { from: 'ADAPT', to: 'EVOLVE', inputContract: 'approved adaptation', outputContract: 'evolution proposal', proofRequirement: 'simulation plan exists', failClosed: true },
  { from: 'EVOLVE', to: 'REGRESSION_TEST', inputContract: 'verified evolution', outputContract: 'regression result', proofRequirement: 'post-change verification exists', failClosed: true },
  { from: 'REGRESSION_TEST', to: 'CONTINUE', inputContract: 'regression result', outputContract: 'next loop state', proofRequirement: 'no blocking regression remains', failClosed: true },
])

export function getLoopTransition(from: LoopStage, to: LoopStage): LoopTransitionContract | null {
  return LOOP_TRANSITIONS.find((transition) => transition.from === from && transition.to === to) ?? null
}

export function assertLoopTransition(from: LoopStage, to: LoopStage): void {
  if (!getLoopTransition(from, to)) throw new Error(`Continuous loop transition violation: ${from} → ${to} is not an authorized transition.`)
}

export const CRITICAL_HIGH_RISK_DOMAINS = Object.freeze(new Set(['public_equity', 'security', 'regulatory', 'business_due_diligence', 'internal_finance']))
export function riskClassForDomain(domain: string, operation?: string): RiskClass {
  const normalized = domain.trim().toLowerCase()
  if (CRITICAL_HIGH_RISK_DOMAINS.has(normalized)) return 'HIGH'
  if (/\b(?:decision|recommend|execute|deploy|production|invest|buy|sell|transfer)\b/i.test(operation ?? '')) return 'HIGH'
  return 'LOW'
}
export function evidencePolicyFor(input: { domain: string; operation?: string; evidenceRequired?: boolean }): EvidencePolicy {
  if (riskClassForDomain(input.domain, input.operation) !== 'HIGH') return input.evidenceRequired ? 'REQUIRED' : 'NONE'
  return 'DECISION_GRADE'
}
export function buildIntegrationContract(capability: string): IntegrationContract {
  const entry = CANONICAL_CAPABILITY_LEDGER[capability]
  if (!entry) throw new Error(`No canonical capability ledger entry exists for ${capability}.`)
  return {
    capability,
    canonicalOwner: entry.canonicalOwner,
    entryPoint: entry.runtimeEntryPoints[0] ?? 'unknown',
    inputContract: entry.requiredContracts.join(', '),
    outputContract: entry.producedEvidence.join(', '),
    verificationContract: entry.verificationMethod,
    outcomeContract: capability === 'outcome_tracking' ? 'recommendation outcome correlation' : 'request result',
    failClosed: riskClassForDomain(entry.domain) === 'HIGH' || entry.integrationStatus === 'MISSING',
  }
}
export function assertCanonicalOwner(capability: string, owner: string): void {
  const entry = CANONICAL_CAPABILITY_LEDGER[capability]
  if (!entry) throw new Error(`Unknown canonical capability: ${capability}`)
  if (entry.canonicalOwner !== owner) throw new Error(`Non-canonical implementation for ${capability}: ${owner}; canonical owner is ${entry.canonicalOwner}.`)
}
export function assertRuntimeIntegration(input: { capability: string; owner: string; runtimeEntryPoint: string; verified: boolean }): void {
  assertCanonicalOwner(input.capability, input.owner)
  const entry = CANONICAL_CAPABILITY_LEDGER[input.capability]
  if (!entry.runtimeEntryPoints.includes(input.runtimeEntryPoint)) throw new Error(`Runtime entry point ${input.runtimeEntryPoint} is not registered for ${input.capability}.`)
  if (!input.verified) throw new Error(`Runtime integration proof is required for ${input.capability}.`)
}
export const ARCHITECTURE_INTEGRITY_VERSION = 4
export const ARCHITECTURE_INTEGRITY_CI_GATE = CI_WORKFLOW