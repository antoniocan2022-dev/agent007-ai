/** Canonical architecture contract for the CEO cognitive system. */
export const CEO_SYSTEM_CONTRACT = Object.freeze({
  schemaVersion: 1,
  identity: 'one_consistent_ceo',
  semanticAuthority: 'canonical_conversation_pipeline',
  decisionAuthority: 'conversation_decision_contract',
  evidenceGate: 'curiosity_then_requirement',
  capabilityAbstraction: 'capability_before_tool',
  evidenceTruth: ['known', 'inferred', 'unverified', 'verified', 'stale', 'contradictory'] as const,
  worldModel: 'single_world_with_facets',
  executionTruth: 'execution_requires_observable_completion_and_verification',
  responseBoundary: 'internal_state_never_leaks_to_user',
  duplicatePolicy: 'extend_canonical_modules; do_not_create_parallel_authorities',
} as const)

export type CeoEvidenceTruthState = (typeof CEO_SYSTEM_CONTRACT.evidenceTruth)[number]

export function assertCeoSystemContract(): true {
  if (CEO_SYSTEM_CONTRACT.identity !== 'one_consistent_ceo') throw new Error('CEO identity contract invalid')
  if (CEO_SYSTEM_CONTRACT.semanticAuthority !== 'canonical_conversation_pipeline') throw new Error('CEO semantic authority invalid')
  if (CEO_SYSTEM_CONTRACT.decisionAuthority !== 'conversation_decision_contract') throw new Error('CEO decision authority invalid')
  if (CEO_SYSTEM_CONTRACT.capabilityAbstraction !== 'capability_before_tool') throw new Error('CEO capability abstraction invalid')
  return true
}