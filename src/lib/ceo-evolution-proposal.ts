import type { ToolOutcomeSnapshot } from './ceo-tool-outcome-intelligence'
import type { ConversationalHealthSignal } from './evolution-engine'

export type EvolutionEvidenceSource = 'tool_outcome' | 'conversational_health'
export type EvolutionRiskLevel = 'low' | 'medium' | 'high'
export type EvolutionProposalStatus = 'proposed' | 'reviewed' | 'approved' | 'rejected'

export interface EvolutionProposal {
  schemaVersion: 1
  id: string
  observedWeakness: string
  evidenceSource: EvolutionEvidenceSource
  evidenceSummary: string
  proposedChange: string
  riskLevel: EvolutionRiskLevel
  status: EvolutionProposalStatus
  reviewedBy?: string
  riskAcknowledged?: boolean
  reviewNotes?: string
}

const TOOL_FAILURE_THRESHOLD = 0.6 // sustained failure rate, not a single bad run
const TOOL_MIN_OBSERVATIONS = 8 // enough real experience to act on, not noise
const INCIDENT_FREQUENCY_THRESHOLD = 5 // repeated occurrences of the same class within the window

// Deliberately conservative, threshold-based pattern detection over real, already-collected
// evidence -- not open-ended reasoning about what might be wrong. Every proposal this produces is
// directly traceable to a specific, checkable number, so a human reviewing it can verify the claim
// themselves rather than trusting an unexplained judgment call.
export function detectToolWeakness(snapshot: ToolOutcomeSnapshot): EvolutionProposal | null {
  if (snapshot.observations < TOOL_MIN_OBSERVATIONS) return null
  const failureRate = 1 - snapshot.successRate / 100
  if (failureRate < TOOL_FAILURE_THRESHOLD) return null
  return {
    schemaVersion: 1,
    id: `evolution_tool_${snapshot.toolId}_${snapshot.capability}_${Date.now()}`,
    observedWeakness: `Tool "${snapshot.toolId}" for capability "${snapshot.capability}" has a sustained real failure rate of ${Math.round(failureRate * 100)}% across ${snapshot.observations} observed uses.`,
    evidenceSource: 'tool_outcome',
    evidenceSummary: `successRate=${snapshot.successRate}%, observations=${snapshot.observations}, avgLatencyMs=${snapshot.avgLatencyMs}, confidence=${snapshot.confidence}%.`,
    proposedChange: `Review whether "${snapshot.toolId}" should remain the default choice for "${snapshot.capability}", or whether an alternative tool/configuration should be investigated. This is a candidate for investigation, not an instruction to remove or replace anything automatically.`,
    riskLevel: snapshot.confidence >= 60 ? 'medium' : 'low',
    status: 'proposed',
  }
}

export function detectConversationalWeakness(signal: ConversationalHealthSignal): EvolutionProposal | null {
  if (!signal.mostFrequentClass) return null
  const count = signal.byInputClass[signal.mostFrequentClass] ?? 0
  if (count < INCIDENT_FREQUENCY_THRESHOLD) return null
  return {
    schemaVersion: 1,
    id: `evolution_conversation_${signal.mostFrequentClass}_${Date.now()}`,
    observedWeakness: `Conversational incidents of class "${signal.mostFrequentClass}" occurred ${count} times in the last ${signal.windowHours} hours, out of ${signal.incidentCount} total incidents.`,
    evidenceSource: 'conversational_health',
    evidenceSummary: `byInputClass=${JSON.stringify(signal.byInputClass)}.`,
    proposedChange: `Review the recent incident candidates for class "${signal.mostFrequentClass}" (see the incident-regression-candidate pipeline) for a recurring root cause worth addressing.`,
    riskLevel: count >= INCIDENT_FREQUENCY_THRESHOLD * 2 ? 'medium' : 'low',
    status: 'proposed',
  }
}

// The governance gate. This is the one function in this module that determines whether a proposal
// is treated as reviewed -- and it can never be satisfied by anything the system itself supplies.
// reviewedBy and riskAcknowledged must be genuinely provided by a human; there is no default, no
// inference, and no way to construct a satisfying value programmatically from the proposal's own
// fields. Even a fully "approved" proposal produces only a human-readable checklist below, never a
// file write, config change, or code execution -- matching the roadmap's explicit rule that learning
// and proposal generation may be autonomous, but system-changing implementation remains governed.
export function reviewEvolutionProposal(proposal: EvolutionProposal, review: { reviewedBy: string; riskAcknowledged: boolean; approved: boolean; reviewNotes?: string }): EvolutionProposal {
  if (!review.reviewedBy.trim()) throw new Error('A proposal cannot be reviewed without a genuine, named reviewer.')
  if (!review.riskAcknowledged) throw new Error('A proposal cannot be approved without the reviewer explicitly acknowledging the stated risk.')
  return { ...proposal, status: review.approved ? 'approved' : 'rejected', reviewedBy: review.reviewedBy, riskAcknowledged: review.riskAcknowledged, reviewNotes: review.reviewNotes }
}

// The only "actionable" output this module can ever produce: a plain-text checklist for a human to
// carry out manually. There is no function anywhere in this file that writes to source, config, or
// executes anything -- deliberately, since that boundary is the entire point of this module.
export function renderEvolutionImplementationChecklist(proposal: EvolutionProposal): string {
  if (proposal.status !== 'approved') throw new Error(`Cannot render an implementation checklist for a proposal that is not approved (status: "${proposal.status}"). This requires an explicit, genuine human review first.`)
  return [
    `EVOLUTION PROPOSAL: ${proposal.id}`,
    `Approved by: ${proposal.reviewedBy}`,
    `Risk level: ${proposal.riskLevel} (acknowledged: ${proposal.riskAcknowledged ? 'yes' : 'no'})`,
    `Observed weakness: ${proposal.observedWeakness}`,
    `Evidence: ${proposal.evidenceSummary}`,
    `Proposed change: ${proposal.proposedChange}`,
    proposal.reviewNotes ? `Reviewer notes: ${proposal.reviewNotes}` : '',
    'This checklist does not implement anything. Any actual code, config, or policy change requires a separate, explicit implementation step outside this system, following the same audit-and-verify discipline as every other change.',
  ].filter(Boolean).join('\n')
}
