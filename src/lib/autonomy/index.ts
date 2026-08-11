export * from './autonomy-index'
export * from './autonomy-policy'
export * from './mission-state'
export * from './decision-score'
export * from './autonomy-telemetry'
export * from './autonomy-runtime'
export * from './capability-registry'
export * from './operational-evidence-bridge'

// Keep the two evidence contracts distinct at the public barrel boundary.
// Runtime telemetry owns AutonomyMissionEvidence; the operational scorecard
// owns OperationalMissionEvidence. Export the scorecard API explicitly so a
// future same-named telemetry type cannot create an ambiguous barrel export.
export {
  calculateAutonomyScorecard,
  meetsAutonomyTarget,
  type AutonomyScorecard,
  type OperationalMissionEvidence,
} from './autonomy-scorecard'
