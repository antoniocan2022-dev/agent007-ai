import { describe, expect, test } from 'bun:test'
import { buildCeoDegradedResponse } from '@/lib/ceo-degraded-mode'
import { EMPTY_PARTNER_INTELLIGENCE, type PartnerIntelligenceSummary } from '@/lib/ceo-partner-intelligence'
import type { LeaderPerformanceRecord } from '@/lib/ceo-leadership-performance'

// Production incident 2026-09-12: a real self-assessment request ("give me a full self-assessment
// across partners, leadership, strategy, and decisions") failed the quality gate and fell through to
// buildCeoDegradedResponse, which produced the same fixed boilerplate template every time, decorated
// with 4 unrelated raw memory records pulled from a generic recallPersistentMemory() search keyed on
// the raw objective text. route.ts already fetches partner intelligence, executive state, the
// leadership ledger, and the strategic horizon for self-assessment turns -- the primary generation path
// renders them, but degraded mode never received them at all. This file locks in the fix: degraded mode
// now renders the same real subsystem data the primary path uses, instead of a generic memory dump.

const noRecall = async () => []

describe('degraded self-assessment fallback grounds in real subsystem state', () => {
  test('renders real partner and leadership data instead of the generic memory dump when subsystem data is supplied', async () => {
    const partnerIntelligence: PartnerIntelligenceSummary = {
      ...EMPTY_PARTNER_INTELLIGENCE,
      dataAvailable: true,
      totalPartners: 2,
      activePartners: 1,
      atRiskCount: 1,
      totalRevenueGenerated: 4200,
      topPartners: [{ id: 'p1', partnerName: 'Acme Affiliates', partnerType: 'affiliate', status: 'active', revenueGenerated: 4200, commissionRate: 0.1, daysSinceUpdate: 3, health: 'stable' }],
      atRiskPartners: [],
    }
    const leadershipLedger: LeaderPerformanceRecord[] = [
      { leaderId: 'ops-lead-1', mandate: { mission: 'growth', class: 'operations', riskLevel: 'medium' }, missionsInvolved: 5, stagesAdvanced: 9, retries: 1, escalations: 0, timesReplaced: 0, reliabilityScore: 0.9, lastActiveAt: new Date().toISOString() },
    ]

    const result = await buildCeoDegradedResponse({
      objective: 'Give me a full self-assessment across partners, leadership, strategy, and decisions',
      intent: 'self_assessment',
      reason: 'Quality gate did not pass after the allowed escalation depth.',
      failureReason: 'claim_consistency_failure',
      recall: noRecall,
      partnerIntelligence,
      leadershipLedger,
    })

    expect(result.content).toContain('Acme Affiliates')
    expect(result.content).toContain('ops-lead-1')
    expect(result.content).not.toContain("Here's what I can ground that in internally")
  })

  test('falls back to the generic architecture answer with no fabricated grounding when no subsystem data is supplied', async () => {
    const result = await buildCeoDegradedResponse({
      objective: 'Give me a full self-assessment across partners, leadership, strategy, and decisions',
      intent: 'self_assessment',
      reason: 'Quality gate did not pass after the allowed escalation depth.',
      failureReason: 'claim_consistency_failure',
      recall: noRecall,
    })

    expect(result.content).toContain("Here's my honest self-assessment")
    expect(result.content).not.toContain('Acme Affiliates')
  })
})
