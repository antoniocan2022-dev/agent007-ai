import type { ExecutiveBusinessState } from './ceo-executive-state'
import type { PartnerIntelligenceSummary } from './ceo-partner-intelligence'
import type { LeaderPerformanceRecord } from './ceo-leadership-performance'
import type { RecommendationLedgerSummary } from './ceo-outcome-learning'
import type { VentureDecisionResult } from './venture-decision-engine'

export type DomainSignal = 'positive' | 'neutral' | 'negative' | 'unknown'
export type ExecutiveJudgment = 'PROCEED' | 'PROCEED_WITH_CAUTION' | 'HOLD' | 'ESCALATE'

export interface ExecutiveDecisionDomainSignals {
  business: DomainSignal
  tech: DomainSignal
  people: DomainSignal
  partners: DomainSignal
  capital: DomainSignal
  risk: DomainSignal
}

export interface ExecutiveDecisionSynthesis {
  judgment: ExecutiveJudgment
  // Fraction of the 6 domains that had real data to reason from, not a fabricated certainty --
  // a synthesis built from 2 known domains and 4 unknowns is reported as exactly that.
  dataCompleteness: number
  domains: ExecutiveDecisionDomainSignals
  reasons: string[]
}

export interface ExecutiveDecisionSynthesisInput {
  executive: ExecutiveBusinessState
  partners: PartnerIntelligenceSummary
  leadership: readonly LeaderPerformanceRecord[]
  systemIncidents: readonly string[]
  // CEO executive-core integration (2026-09-13): this function was the one place in the codebase that
  // reconciles cross-domain state into a single judgment, but it only ever saw a fraction of what was
  // already being fetched the same turn -- ceo-strategic-horizon.ts's open-decision governance signal
  // and ceo-venture-state.ts's portfolio decision gate were computed and rendered as separate, un-
  // reconciled prompt blocks in ceo-cognitive-lifecycle.ts, never reaching this synthesis at all. Both
  // are optional: a caller without a canonicalContext/strategicHorizon fetch simply omits them, and the
  // domain the signal would have informed reports 'unknown' exactly as it already does for any other
  // missing input, rather than fabricating a signal from data that was never fetched.
  ventureDecision?: VentureDecisionResult | null
  strategicHorizonDecisions?: RecommendationLedgerSummary
}

const MIN_LEADERSHIP_SAMPLE = 3 // resolved outcomes below this are too thin to call a leader unreliable

function businessSignal(executive: ExecutiveBusinessState, reasons: string[]): DomainSignal {
  if (!executive.strategy.dataAvailable) return 'unknown'
  if (executive.strategy.items.length === 0) return 'neutral'
  // A 'planned' item at 0% progress is normal -- it hasn't started yet, that's expected, not a
  // problem. The real warning sign is an item already marked 'in_progress' (someone is supposedly
  // working it) that still shows 0% progress -- genuinely stuck, not merely queued.
  const stalled = executive.strategy.items.filter((item) => item.status === 'in_progress' && item.progress === 0)
  if (stalled.length > 0) { reasons.push(`${stalled.length} strategy item(s) marked in-progress remain at 0% progress: ${stalled.map((item) => item.title).join(', ')}.`); return 'negative' }
  return 'positive'
}

function techSignal(systemIncidents: readonly string[], reasons: string[]): DomainSignal {
  if (systemIncidents.length > 0) { reasons.push(`${systemIncidents.length} system incident(s) active: ${systemIncidents.join('; ')}.`); return 'negative' }
  return 'positive'
}

function peopleSignal(leadership: readonly LeaderPerformanceRecord[], reasons: string[]): DomainSignal {
  const withSample = leadership.filter((record) => record.stagesAdvanced + record.escalations + record.timesReplaced >= MIN_LEADERSHIP_SAMPLE)
  if (withSample.length === 0) return 'unknown'
  const unreliable = withSample.filter((record) => record.reliabilityScore < 0.5)
  if (unreliable.length > 0) { reasons.push(`${unreliable.length} leader(s) with a proven track record are below 50% reliability: ${unreliable.map((record) => record.leaderId).join(', ')}.`); return 'negative' }
  return 'positive'
}

function partnersSignal(partners: PartnerIntelligenceSummary, reasons: string[]): DomainSignal {
  if (!partners.dataAvailable) return 'unknown'
  if (partners.totalPartners === 0) return 'neutral'
  if (partners.atRiskCount > 0) { reasons.push(`${partners.atRiskCount} partner relationship(s) at risk.`); return 'negative' }
  return 'positive'
}

function capitalSignal(executive: ExecutiveBusinessState, reasons: string[]): DomainSignal {
  if (!executive.resources.dataAvailable) return 'unknown'
  if (!executive.resources.leaseHealthy) { reasons.push('Autonomy lease is unhealthy.'); return 'negative' }
  if ((executive.resources.netRevenue ?? 0) < 0) { reasons.push('Net revenue is negative over the measured window.'); return 'negative' }
  return 'positive'
}

// CEO executive-core integration (2026-09-13): folds in two governance signals that were already
// computed elsewhere in the same request but never reached this synthesis. `executive.decisions`
// (RecommendationLedgerSummary) was already part of ExecutiveBusinessState -- passed into this function
// all along -- but no domain signal ever read it; a venture with 5 decisions overdue for review scored
// identically to one with zero. `ventureDecision` (ceo-venture-state.ts's portfolio decision gate) was
// computed and rendered as its own separate "LIVE VENTURE STATE" prompt block but never folded into the
// one function whose whole job is cross-domain reconciliation.
function riskSignal(executive: ExecutiveBusinessState, ventureDecision: VentureDecisionResult | null | undefined, strategicHorizonDecisions: RecommendationLedgerSummary | undefined, reasons: string[]): DomainSignal {
  if (ventureDecision?.irreversibleActionBlocked) { reasons.push(`Venture portfolio gate blocks an irreversible action (decision: ${ventureDecision.decision}).`); return 'negative' }
  if (ventureDecision && (ventureDecision.decision === 'reject' || ventureDecision.decision === 'kill')) { reasons.push(`Venture portfolio gate returned '${ventureDecision.decision}'.`); return 'negative' }
  // executive.decisions is venture-scoped (more precise); the global strategicHorizonDecisions is used
  // only as a fallback when no venture-scoped ledger was fetched this turn, to avoid double-reporting
  // the same overdue count from two overlapping scopes of the same underlying ledger.
  const ledger = executive.decisions.dataAvailable ? executive.decisions : strategicHorizonDecisions
  if (ledger && ledger.overdueReview > 0) { reasons.push(`${ledger.overdueReview} recorded decision(s) are overdue for owner review.`); return 'negative' }
  if (!executive.risk.dataAvailable) return 'unknown'
  if (executive.risk.status === 'BLOCKED') { reasons.push(`Venture readiness is BLOCKED (score ${executive.risk.score}/${executive.risk.threshold}).`); return 'negative' }
  if (executive.risk.status === 'NOT_READY') { reasons.push(`Venture readiness is NOT_READY: ${executive.risk.missingEvidence.join(', ') || 'unspecified gaps'}.`); return 'neutral' }
  return 'positive'
}

// A real, deterministic function over real, already-fetched cross-domain state -- it never queries
// anything itself and never fabricates a domain it wasn't given data for (that domain reports
// 'unknown', which counts against dataCompleteness rather than being silently treated as fine).
export function synthesizeExecutiveDecision(input: ExecutiveDecisionSynthesisInput): ExecutiveDecisionSynthesis {
  const reasons: string[] = []
  const domains: ExecutiveDecisionDomainSignals = {
    business: businessSignal(input.executive, reasons),
    tech: techSignal(input.systemIncidents, reasons),
    people: peopleSignal(input.leadership, reasons),
    partners: partnersSignal(input.partners, reasons),
    capital: capitalSignal(input.executive, reasons),
    risk: riskSignal(input.executive, input.ventureDecision, input.strategicHorizonDecisions, reasons),
  }
  const values = Object.values(domains)
  const known = values.filter((signal) => signal !== 'unknown')
  const negatives = values.filter((signal) => signal === 'negative').length
  const dataCompleteness = Number((known.length / values.length).toFixed(3))

  let judgment: ExecutiveJudgment
  if (domains.risk === 'negative' || negatives >= 3) judgment = 'ESCALATE'
  else if (negatives >= 1) judgment = 'HOLD'
  else if (dataCompleteness < 0.5) judgment = 'PROCEED_WITH_CAUTION'
  else judgment = 'PROCEED'

  return { judgment, dataCompleteness, domains, reasons }
}

export function renderExecutiveDecisionSynthesis(synthesis: ExecutiveDecisionSynthesis): string {
  const domainList = Object.entries(synthesis.domains).map(([domain, signal]) => `${domain}=${signal}`).join(', ')
  const reasonText = synthesis.reasons.length ? ` Reasons: ${synthesis.reasons.join(' ')}` : ''
  return `Judgment: ${synthesis.judgment} (data completeness ${(synthesis.dataCompleteness * 100).toFixed(0)}%). Domains: ${domainList}.${reasonText}`
}
