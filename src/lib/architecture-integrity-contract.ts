/**
 * Canonical architecture-integrity contract.
 *
 * This extends the existing Architecture Control Plane; it is deliberately
 * metadata-first and does not introduce another tool/capability registry.
 * It makes ownership, runtime reachability, evidence and proof explicit.
 */

export type ArchitectureLifecycleState = 'DISCOVERED' | 'CANONICAL' | 'INTEGRATED' | 'OBSERVED' | 'PROVEN'
export type IntegrationStatus = 'MISSING' | 'PARTIAL' | 'INTEGRATED' | 'PROVEN'
export type RiskClass = 'LOW' | 'HIGH'
export type EvidencePolicy = 'NONE' | 'REQUIRED' | 'DECISION_GRADE'

export interface CanonicalCapabilityLedgerEntry {
  capability: string
  canonicalOwner: string
  domain: string
  purpose: string
  runtimeEntryPoints: string[]
  consumers: string[]
  requiredContracts: string[]
  producedEvidence: string[]
  verificationMethod: string
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

export const CANONICAL_CAPABILITY_LEDGER: Readonly<Record<string, CanonicalCapabilityLedgerEntry>> = Object.freeze({
  semantic_interpretation: {
    capability: 'semantic_interpretation', canonicalOwner: 'ceo-semantic-interpreter', domain: 'CEO',
    purpose: 'Resolve meaning before routing.', runtimeEntryPoints: ['src/app/api/agent/route.ts'],
    consumers: ['ceo-pre-router', 'ceo-cognitive-lifecycle'], requiredContracts: ['canonical conversation context'],
    producedEvidence: ['semantic interpretation'], verificationMethod: 'semantic regression tests', integrationStatus: 'INTEGRATED', productionObserved: true, duplicateRisk: 'LOW', lifecycleState: 'OBSERVED',
  },
  decision_contract: {
    capability: 'decision_contract', canonicalOwner: 'ceo-conversation-decision-contract', domain: 'CEO',
    purpose: 'Authoritatively define response/action/evidence requirements.', runtimeEntryPoints: ['src/app/api/agent/route.ts'],
    consumers: ['ceo-cognitive-lifecycle', 'ceo-pre-router'], requiredContracts: ['canonical conversation context'],
    producedEvidence: ['intent', 'response action', 'evidence requirement'], verificationMethod: 'contract regression tests', integrationStatus: 'INTEGRATED', productionObserved: true, duplicateRisk: 'LOW', lifecycleState: 'OBSERVED',
  },
  capability_architecture: {
    capability: 'capability_architecture', canonicalOwner: 'ceo-capability-architecture', domain: 'CEO',
    purpose: 'Map decisions to enterprise capabilities before tools.', runtimeEntryPoints: ['src/lib/ceo-cognitive-kernel.ts'],
    consumers: ['ceo-cognitive-kernel', 'ceo-tool-selection'], requiredContracts: ['decision plan'],
    producedEvidence: ['required capabilities'], verificationMethod: 'capability mapping tests', integrationStatus: 'INTEGRATED', productionObserved: true, duplicateRisk: 'MEDIUM', lifecycleState: 'OBSERVED',
  },
  evidence_acquisition: {
    capability: 'evidence_acquisition', canonicalOwner: 'ceo-evidence-planner + ceo-evidence-executor', domain: 'Evidence',
    purpose: 'Acquire fresh external evidence under a governed plan.', runtimeEntryPoints: ['src/app/api/agent/route.ts'],
    consumers: ['ceo-cognitive-lifecycle'], requiredContracts: ['external evidence plan'],
    producedEvidence: ['evidence bundle', 'provenance', 'freshness', 'source tiers'], verificationMethod: 'decision-grade evidence gate', integrationStatus: 'INTEGRATED', productionObserved: true, duplicateRisk: 'LOW', lifecycleState: 'INTEGRATED',
  },
  response_quality: {
    capability: 'response_quality', canonicalOwner: 'ceo-response-quality-gate', domain: 'CEO',
    purpose: 'Reject incomplete, contradictory or unsupported answers.', runtimeEntryPoints: ['src/lib/ceo-cognitive-lifecycle.ts'],
    consumers: ['ceo-cognitive-lifecycle'], requiredContracts: ['quality result'],
    producedEvidence: ['quality decision'], verificationMethod: 'quality-gate regression suite', integrationStatus: 'INTEGRATED', productionObserved: true, duplicateRisk: 'LOW', lifecycleState: 'OBSERVED',
  },
  outcome_tracking: {
    capability: 'outcome_tracking', canonicalOwner: 'ceo-outcome-learning + architecture-control-plane', domain: 'Learning',
    purpose: 'Correlate recommendations and business outcomes.', runtimeEntryPoints: ['src/app/api/agent/route.ts', 'src/lib/architecture-control-plane.ts'],
    consumers: ['closed-loop-improvement', 'evolution-engine'], requiredContracts: ['recommendation correlation', 'business outcome'],
    producedEvidence: ['outcome record'], verificationMethod: 'outcome identity/idempotency tests', integrationStatus: 'PARTIAL', productionObserved: false, duplicateRisk: 'MEDIUM', lifecycleState: 'INTEGRATED',
  },
  governed_evolution: {
    capability: 'governed_evolution', canonicalOwner: 'evolution-engine', domain: 'Evolution',
    purpose: 'Observe, recommend, approve, apply and verify organizational improvements.', runtimeEntryPoints: ['src/lib/evolution-engine.ts'],
    consumers: ['closed-loop-improvement'], requiredContracts: ['evolution cycle'],
    producedEvidence: ['IQ', 'health report', 'cycle record'], verificationMethod: 'evolution/control-plane tests', integrationStatus: 'PARTIAL', productionObserved: false, duplicateRisk: 'LOW', lifecycleState: 'INTEGRATED',
  },
})

export const CRITICAL_HIGH_RISK_DOMAINS = Object.freeze(new Set([
  'public_equity', 'security', 'regulatory', 'business_due_diligence', 'internal_finance',
]))

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
    outcomeContract: capability === 'outcome_tracking' ? 'architecture business outcome' : 'request result',
    failClosed: riskClassForDomain(entry.domain) === 'HIGH',
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

export const ARCHITECTURE_INTEGRITY_VERSION = 1
