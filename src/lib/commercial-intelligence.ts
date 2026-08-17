/** Canonical public boundary for Agent007's three commercial intelligence layers. */
export type { CommercialMemoryEntry, CommercialMemoryKind, CommercialMemoryQuery } from './commercial-memory'
export { listCommercialMemory, recallCommercialMemory, rememberCommercial, reinforceCommercialMemory, validateCommercialMemoryContracts } from './commercial-memory'

export type { CommercialWorldEntity, CommercialWorldEntityType, CommercialWorldRelation, CommercialWorldRelationType, CommercialWorldSnapshot } from './commercial-world-model'
export { getCommercialWorldSnapshot, projectCommercialWorld, upsertCommercialWorldEntity, upsertCommercialWorldRelation, validateCommercialWorldModelContracts } from './commercial-world-model'

export type { CausalAnalysisResult, CausalHypothesisStatus, CausalObservationKind, CommercialCausalHypothesis, CommercialCausalObservation } from './commercial-causal-engine'
export { analyzeCommercialCausality, evaluateCommercialCausalOutcome, listCommercialCausalHypotheses, recordCommercialCausalObservation, validateCommercialCausalContracts } from './commercial-causal-engine'

export const COMMERCIAL_INTELLIGENCE_VERSION = 1
export const COMMERCIAL_INTELLIGENCE_LAYERS = Object.freeze(['memory', 'world-model', 'causal-engine'] as const)

export function validateCommercialIntelligenceContracts(): string[] {
  const errors: string[] = []
  if (COMMERCIAL_INTELLIGENCE_LAYERS.length !== 3) errors.push('Commercial intelligence must expose exactly three layers.')
  if (new Set(COMMERCIAL_INTELLIGENCE_LAYERS).size !== COMMERCIAL_INTELLIGENCE_LAYERS.length) errors.push('Commercial intelligence layers must be unique.')
  return errors
}
