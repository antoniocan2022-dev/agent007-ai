/**
 * Venture Decision Engine — converts Venture OS policy + evidence into a
 * lifecycle decision and, when explicitly eligible, applies reversible/kill
 * actions to the existing Portfolio source of truth.
 */

import { db } from './db'
import {
  CEO_VENTURE_MANDATE,
  validateVentureMandate,
} from './venture-mandate'
import {
  calculateOpportunityScore,
  calculateVentureHealth,
  type OpportunityScoreInput,
  type VentureHealthInput,
  type ScoreEvidence,
} from './venture-scorecard'
import {
  getPortfolio,
  retireBusiness,
  updateBusiness,
  type Business,
  type BusinessLifecycle,
} from './business-portfolio'

export const VENTURE_DECISION_ENGINE_VERSION = 1

export type VentureDecision =
  | 'reject'
  | 'validate'
  | 'build'
  | 'launch_ready'
  | 'scale'
  | 'optimize'
  | 'experiment'
  | 'pivot'
  | 'kill'
  | 'hold'

export interface VentureDecisionInput {
  businessId: string
  opportunity?: OpportunityScoreInput
  health?: VentureHealthInput
  launchVerified?: boolean
  requestedSpend?: number
  monthlyCommittedSpend?: number
}

export interface VentureDecisionResult {
  engineVersion: number
  businessId: string
  lifecycle: BusinessLifecycle | null
  decision: VentureDecision
  confidence: number
  autonomousEligible: boolean
  irreversibleActionBlocked: boolean
  score: number | null
  reasons: string[]
  scorecard: {
    opportunity?: ReturnType<typeof calculateOpportunityScore>
    health?: ReturnType<typeof calculateVentureHealth>
  }
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

function spendAllowed(requestedSpend: number = 0, monthlyCommittedSpend: number = 0): boolean {
  return requestedSpend >= 0 &&
    requestedSpend <= CEO_VENTURE_MANDATE.maximumSingleSpendWithoutApproval &&
    monthlyCommittedSpend + requestedSpend <= CEO_VENTURE_MANDATE.maximumMonthlyBurnWithoutApproval
}

function deriveHealthInput(business: Business, evidence: ScoreEvidence[]): VentureHealthInput {
  const revenue = clamp((business.monthlyRevenue / 1000) * 100)
  const margin = business.monthlyRevenue > 0 ? clamp((business.netRevenue / business.monthlyRevenue) * 100) : 0
  const demand = clamp((business.customerCount / 10) * 100)
  const acquisitionEfficiency = business.monthlyCost > 0
    ? clamp(50 + (business.roi / 2))
    : business.monthlyRevenue > 0 ? 70 : 0
  const operationalRisk = clamp(70 + Math.min(30, business.roi / 2))

  return {
    marketEvidence: evidence.length > 0 ? clamp(50 + evidence.reduce((sum, item) => sum + item.confidence, 0) / evidence.length * 50) : 0,
    demand,
    conversion: 0,
    revenue,
    margin,
    customerSatisfaction: 0,
    acquisitionEfficiency,
    automation: clamp(business.automationLevel),
    operationalRisk,
    evidenceConfidence: evidence.length > 0 ? evidence.reduce((sum, item) => sum + item.confidence, 0) / evidence.length : 0,
    evidence,
  }
}

function deriveLifecycleDecision(business: Business, health: ReturnType<typeof calculateVentureHealth>): VentureDecision {
  if (health.blockingReasons.length > 0 && health.decision === 'kill_or_pivot') return 'hold'
  switch (health.decision) {
    case 'scale': return 'scale'
    case 'optimize': return 'optimize'
    case 'experiment': return 'experiment'
    case 'kill_or_pivot':
      return business.customerCount > 0 || business.monthlyRevenue > 0 ? 'pivot' : 'kill'
  }
}

export async function evaluateVentureDecision(input: VentureDecisionInput): Promise<VentureDecisionResult> {
  const mandateErrors = validateVentureMandate()
  const business = (await getPortfolio()).find((item) => item.businessId === input.businessId) ?? null
  const reasons = [...mandateErrors]

  if (!business) {
    return {
      engineVersion: VENTURE_DECISION_ENGINE_VERSION,
      businessId: input.businessId,
      lifecycle: null,
      decision: 'hold',
      confidence: 0,
      autonomousEligible: false,
      irreversibleActionBlocked: true,
      score: null,
      reasons: ['Business not found.', ...reasons],
      scorecard: {},
    }
  }

  if (input.requestedSpend !== undefined && !spendAllowed(input.requestedSpend, input.monthlyCommittedSpend)) {
    reasons.push('Requested spend exceeds the CEO Venture Mandate guardrail.')
  }

  if (input.opportunity) {
    const opportunity = calculateOpportunityScore(input.opportunity)
    if (opportunity.score < CEO_VENTURE_MANDATE.opportunityScoreMinimum) {
      reasons.push('Opportunity score is below the CEO advance threshold.')
      return {
        engineVersion: VENTURE_DECISION_ENGINE_VERSION,
        businessId: business.businessId,
        lifecycle: business.lifecycle,
        decision: 'reject',
        confidence: opportunity.confidence,
        autonomousEligible: reasons.length === mandateErrors.length && opportunity.decisionReady,
        irreversibleActionBlocked: true,
        score: opportunity.score,
        reasons: [...reasons, ...opportunity.blockingReasons],
        scorecard: { opportunity },
      }
    }
    if (opportunity.confidence < CEO_VENTURE_MANDATE.validationConfidenceMinimum) {
      reasons.push('Opportunity evidence confidence is below the CEO validation threshold.')
    }
    if (business.lifecycle === 'proposed') {
      const decision: VentureDecision = opportunity.decisionReady ? 'build' : 'validate'
      return {
        engineVersion: VENTURE_DECISION_ENGINE_VERSION,
        businessId: business.businessId,
        lifecycle: business.lifecycle,
        decision,
        confidence: opportunity.confidence,
        autonomousEligible: decision === 'build' && reasons.length === mandateErrors.length && spendAllowed(input.requestedSpend, input.monthlyCommittedSpend),
        irreversibleActionBlocked: true,
        score: opportunity.score,
        reasons: [...reasons, ...opportunity.blockingReasons],
        scorecard: { opportunity },
      }
    }
  }

  const evidence = input.health?.evidence ?? []
  const healthInput = input.health ?? deriveHealthInput(business, evidence)
  const health = calculateVentureHealth(healthInput)
  const decision = deriveLifecycleDecision(business, health)
  const isTerminal = business.lifecycle === 'retired'
  const externalLaunchVerified = input.launchVerified === true

  if (business.lifecycle === 'launched' && !externalLaunchVerified && business.monthlyRevenue === 0 && business.customerCount === 0) {
    reasons.push('Launch remains unverified; external commercial evidence is required before treating the venture as live.')
  }

  if (health.confidence < 0.5) reasons.push('Outcome evidence confidence is below the autonomous decision floor.')
  const autonomousEligible = !isTerminal &&
    mandateErrors.length === 0 &&
    health.confidence >= 0.5 &&
    spendAllowed(input.requestedSpend, input.monthlyCommittedSpend) &&
    (decision !== 'kill' || (health.confidence >= 0.75 && health.evidenceCount >= 2))

  return {
    engineVersion: VENTURE_DECISION_ENGINE_VERSION,
    businessId: business.businessId,
    lifecycle: business.lifecycle,
    decision,
    confidence: health.confidence,
    autonomousEligible,
    irreversibleActionBlocked: decision === 'kill' || decision === 'pivot' || decision === 'launch_ready',
    score: health.score,
    reasons: [...reasons, ...health.blockingReasons],
    scorecard: { health },
  }
}

export async function applyAutonomousVentureDecision(result: VentureDecisionResult): Promise<{
  applied: boolean
  action: VentureDecision
  message: string
}> {
  if (!result.autonomousEligible) {
    return { applied: false, action: result.decision, message: 'Decision is not eligible for autonomous application.' }
  }

  const business = (await getPortfolio()).find((item) => item.businessId === result.businessId)
  if (!business) return { applied: false, action: result.decision, message: 'Business not found.' }

  let applied = false
  let message = 'No state change required.'

  switch (result.decision) {
    case 'scale':
      await updateBusiness(business.businessId, { lifecycle: 'scaling' })
      applied = true
      message = 'Business moved to scaling.'
      break
    case 'optimize':
      if (business.lifecycle === 'scaling') await updateBusiness(business.businessId, { lifecycle: 'active' })
      applied = true
      message = 'Business retained for optimization under current lifecycle.'
      break
    case 'experiment':
      applied = true
      message = 'Business retained for another measured experiment; no destructive mutation applied.'
      break
    case 'kill':
      await retireBusiness(business.businessId, 'CEO Venture Mandate: autonomous kill threshold reached with sufficient independent evidence.')
      applied = true
      message = 'Business retired and existing portfolio retirement learning flow invoked.'
      break
    case 'pivot':
    case 'hold':
    case 'validate':
    case 'build':
    case 'launch_ready':
    case 'reject':
      message = `Decision ${result.decision} requires additional planning/evidence or a separate non-destructive execution capability.`
      break
  }

  try {
    await db.memory.create({
      data: {
        key: `venture_decision_${result.businessId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        category: 'venture_decision_audit',
        value: JSON.stringify({
          engineVersion: result.engineVersion,
          businessId: result.businessId,
          decision: result.decision,
          confidence: result.confidence,
          applied,
          message,
          reasons: result.reasons,
          createdAt: new Date().toISOString(),
        }),
      },
    })
  } catch {
    // Decision application remains authoritative; audit persistence is best-effort.
  }

  return { applied, action: result.decision, message }
}
