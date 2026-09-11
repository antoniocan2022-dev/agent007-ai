import { describe, expect, test } from 'bun:test'
import { synthesizeExecutiveDecision, renderExecutiveDecisionSynthesis, type ExecutiveDecisionSynthesisInput } from '@/lib/ceo-decision-synthesis'
import { EMPTY_EXECUTIVE_BUSINESS_STATE, type ExecutiveBusinessState } from '@/lib/ceo-executive-state'
import { EMPTY_PARTNER_INTELLIGENCE, type PartnerIntelligenceSummary } from '@/lib/ceo-partner-intelligence'
import type { LeaderPerformanceRecord } from '@/lib/ceo-leadership-performance'

function baseInput(overrides: Partial<ExecutiveDecisionSynthesisInput> = {}): ExecutiveDecisionSynthesisInput {
  return { executive: EMPTY_EXECUTIVE_BUSINESS_STATE, partners: EMPTY_PARTNER_INTELLIGENCE, leadership: [], systemIncidents: [], ...overrides }
}

const READY_EXECUTIVE: ExecutiveBusinessState = {
  ...EMPTY_EXECUTIVE_BUSINESS_STATE,
  strategy: { dataAvailable: true, items: [{ id: 's1', phase: 'growth', title: 'Active plan', status: 'active', priority: 'high', progress: 0.5, targetDate: null }] },
  risk: { dataAvailable: true, ventureId: 'venture_001', status: 'READY', score: 100, threshold: 80, missingEvidence: [] },
  resources: { dataAvailable: true, ventureId: 'venture_001', grossRevenue: 1000, netRevenue: 500, currency: 'usd', autonomyMode: 'AUTONOMOUS', leaseHealthy: true },
}

const HEALTHY_PARTNERS: PartnerIntelligenceSummary = { ...EMPTY_PARTNER_INTELLIGENCE, dataAvailable: true, totalPartners: 2, activePartners: 2, atRiskCount: 0 }

function leader(id: string, overrides: Partial<LeaderPerformanceRecord> = {}): LeaderPerformanceRecord {
  return { leaderId: id, mandate: null, missionsInvolved: 1, stagesAdvanced: 4, retries: 0, escalations: 0, timesReplaced: 0, reliabilityScore: 1, lastActiveAt: null, ...overrides }
}

describe('synthesizeExecutiveDecision', () => {
  test('with no real data anywhere, every gated domain is honestly unknown, not fabricated as fine', () => {
    const synthesis = synthesizeExecutiveDecision(baseInput())
    // tech is the one domain that is never gated behind dataAvailable -- provider/incident
    // telemetry is always live-computed (see ceo-world-model.ts's system facet), so "no incidents"
    // is itself a real, known fact rather than missing data.
    expect(synthesis.domains.tech).toBe('positive')
    expect(synthesis.domains.business).toBe('unknown')
    expect(synthesis.domains.people).toBe('unknown')
    expect(synthesis.domains.partners).toBe('unknown')
    expect(synthesis.domains.capital).toBe('unknown')
    expect(synthesis.domains.risk).toBe('unknown')
    expect(synthesis.dataCompleteness).toBeLessThan(0.5)
    expect(synthesis.judgment).toBe('PROCEED_WITH_CAUTION')
  })

  test('all-positive, fully-known cross-domain state yields PROCEED', () => {
    const synthesis = synthesizeExecutiveDecision(baseInput({ executive: READY_EXECUTIVE, partners: HEALTHY_PARTNERS, leadership: [leader('aurora')] }))
    expect(synthesis.domains).toEqual({ business: 'positive', tech: 'positive', people: 'positive', partners: 'positive', capital: 'positive', risk: 'positive' })
    expect(synthesis.dataCompleteness).toBe(1)
    expect(synthesis.judgment).toBe('PROCEED')
  })

  test('a BLOCKED venture readiness forces ESCALATE regardless of every other domain', () => {
    const executive: ExecutiveBusinessState = { ...READY_EXECUTIVE, risk: { dataAvailable: true, ventureId: 'venture_001', status: 'BLOCKED', score: 10, threshold: 80, missingEvidence: ['launch_verification'] } }
    const synthesis = synthesizeExecutiveDecision(baseInput({ executive, partners: HEALTHY_PARTNERS, leadership: [leader('aurora')] }))
    expect(synthesis.judgment).toBe('ESCALATE')
    expect(synthesis.reasons.some((reason) => reason.includes('BLOCKED'))).toBe(true)
  })

  test('a single active system incident makes tech negative and forces at least HOLD', () => {
    const synthesis = synthesizeExecutiveDecision(baseInput({ executive: READY_EXECUTIVE, partners: HEALTHY_PARTNERS, leadership: [leader('aurora')], systemIncidents: ['Groq provider is degraded'] }))
    expect(synthesis.domains.tech).toBe('negative')
    expect(synthesis.judgment).toBe('HOLD')
  })

  test('three or more negative domains escalate even without a blocked venture', () => {
    const executive: ExecutiveBusinessState = { ...READY_EXECUTIVE, resources: { dataAvailable: true, ventureId: 'venture_001', grossRevenue: 100, netRevenue: -50, currency: 'usd', autonomyMode: 'AUTONOMOUS', leaseHealthy: true } }
    const atRiskPartners: PartnerIntelligenceSummary = { ...HEALTHY_PARTNERS, atRiskCount: 1 }
    const synthesis = synthesizeExecutiveDecision(baseInput({ executive, partners: atRiskPartners, leadership: [leader('aurora')], systemIncidents: ['Mistral provider is unhealthy'] }))
    expect(synthesis.judgment).toBe('ESCALATE')
  })

  test('an unproven leader (below the minimum sample) does not count against the people domain', () => {
    const synthesis = synthesizeExecutiveDecision(baseInput({ leadership: [leader('newcomer', { stagesAdvanced: 1, escalations: 0, timesReplaced: 0, reliabilityScore: 0 })] }))
    expect(synthesis.domains.people).toBe('unknown')
  })

  test('a leader with a real proven track record of unreliability makes people negative', () => {
    const synthesis = synthesizeExecutiveDecision(baseInput({ leadership: [leader('struggling', { stagesAdvanced: 1, escalations: 3, timesReplaced: 1, reliabilityScore: 0.2 })] }))
    expect(synthesis.domains.people).toBe('negative')
  })

  test('zero tracked partnerships is neutral, not fabricated as positive or negative', () => {
    const synthesis = synthesizeExecutiveDecision(baseInput({ partners: { ...EMPTY_PARTNER_INTELLIGENCE, dataAvailable: true } }))
    expect(synthesis.domains.partners).toBe('neutral')
  })
})

describe('renderExecutiveDecisionSynthesis', () => {
  test('renders judgment, completeness, domains and reasons', () => {
    const synthesis = synthesizeExecutiveDecision(baseInput({ systemIncidents: ['X provider is degraded'] }))
    const rendered = renderExecutiveDecisionSynthesis(synthesis)
    expect(rendered).toContain('Judgment: HOLD')
    expect(rendered).toContain('tech=negative')
    expect(rendered).toContain('Reasons:')
  })
})
