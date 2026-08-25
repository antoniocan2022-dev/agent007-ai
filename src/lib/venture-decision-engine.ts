/** Venture Decision Engine — converts Venture OS policy + evidence into lifecycle decisions. */
import { db } from './db'
import { CEO_VENTURE_MANDATE, evaluateVentureAction, isSpendWithinGuardrail, validateVentureMandate } from './venture-mandate'
import { calculateOpportunityScore, calculateVentureHealth, type OpportunityScoreInput, type VentureHealthInput, type ScoreEvidence } from './venture-scorecard'
import { getPortfolio, updateBusiness, type Business, type BusinessLifecycle } from './business-portfolio'
import { runContinuousPortfolioLearningCycle, type PortfolioLearningCycleResult } from './portfolio-learning'
import type { VentureLifecycleDecision } from './portfolio-decision-contract'

export const VENTURE_DECISION_ENGINE_VERSION = 6
export type VentureDecision = VentureLifecycleDecision

export interface VentureDecisionInput { businessId: string; opportunity?: OpportunityScoreInput; health?: VentureHealthInput; launchVerified?: boolean; requestedSpend?: number; monthlyCommittedSpend?: number }
export interface VentureDecisionResult { engineVersion: number; businessId: string; lifecycle: BusinessLifecycle | null; decision: VentureDecision; confidence: number; autonomousEligible: boolean; irreversibleActionBlocked: boolean; score: number | null; reasons: string[]; scorecard: { opportunity?: ReturnType<typeof calculateOpportunityScore>; health?: ReturnType<typeof calculateVentureHealth> } }
export interface VentureEvidenceRecord extends ScoreEvidence { businessId: string; evidenceId: string; kind: 'market' | 'customer' | 'payment' | 'analytics' | 'launch' | 'operations' | 'other'; verified: boolean; createdAt: string }
export interface LaunchVerification { source: string; statement: string; confidence: number; verifiedAt?: string }
export interface VentureCycleResult { scanned: number; evaluated: number; applied: number; held: number; killed: number; scaled: number; decisions: VentureDecisionResult[]; learning: PortfolioLearningCycleResult | null }

function clamp(value: number): number { return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0 }
function clampConfidence(value: number): number { return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0 }
function spendAllowed(requestedSpend = 0, monthlyCommittedSpend = 0): boolean { return isSpendWithinGuardrail(requestedSpend, monthlyCommittedSpend) }
function averageEvidenceConfidence(evidence: ScoreEvidence[]): number { return evidence.length ? evidence.reduce((sum, item) => sum + clampConfidence(item.confidence), 0) / evidence.length : 0 }
function metric(evidence: VentureEvidenceRecord[], name: string): number | null { const matches = evidence.filter((item) => item.metric?.name === name && Number.isFinite(item.metric.value)); if (!matches.length) return null; const verified = matches.filter((item) => item.verified); const source = verified.length ? verified : matches; return source.sort((a, b) => new Date(b.observedAt ?? b.createdAt).getTime() - new Date(a.observedAt ?? a.createdAt).getTime())[0].metric?.value ?? null }
function deriveHealthInput(business: Business, evidence: VentureEvidenceRecord[]): VentureHealthInput { const revenue = clamp((business.monthlyRevenue / 1000) * 100); const margin = business.monthlyRevenue > 0 ? clamp((business.netRevenue / business.monthlyRevenue) * 100) : 0; const demand = clamp((business.customerCount / 10) * 100); const conversion = clamp(metric(evidence, 'conversion_rate') ?? 0); const customerSatisfaction = clamp(metric(evidence, 'customer_satisfaction') ?? 0); const acquisitionEfficiency = clamp(metric(evidence, 'acquisition_efficiency') ?? (business.monthlyCost > 0 ? 50 + business.roi / 2 : business.monthlyRevenue > 0 ? 70 : 0)); const operationalRisk = clamp(metric(evidence, 'operational_risk') ?? (70 + Math.min(30, business.roi / 2))); const confidence = averageEvidenceConfidence(evidence); return { marketEvidence: evidence.length ? clamp(50 + confidence * 50) : 0, demand, conversion, revenue, margin, customerSatisfaction, acquisitionEfficiency, automation: clamp(business.automationLevel), operationalRisk, evidenceConfidence: confidence, evidence } }
function deriveLifecycleDecision(business: Business, health: ReturnType<typeof calculateVentureHealth>): VentureDecision { if (health.blockingReasons.length > 0 && health.decision === 'kill_or_pivot') return 'hold'; if (health.decision === 'scale') return 'scale'; if (health.decision === 'optimize') return 'optimize'; if (health.decision === 'experiment') return 'experiment'; return business.customerCount > 0 || business.monthlyRevenue > 0 ? 'pivot' : 'kill' }
function evidenceKeyPrefix(businessId: string): string { return `evidence_${businessId}_` }
function scaleEvidenceComplete(evidence: VentureEvidenceRecord[]): boolean { return ['conversion_rate', 'customer_satisfaction'].every((name) => evidence.some((item) => item.metric?.name === name && item.verified && Number.isFinite(item.metric.value))) }

export async function recordVentureEvidence(input: Omit<VentureEvidenceRecord, 'evidenceId' | 'createdAt'> & { createdAt?: string }): Promise<VentureEvidenceRecord> {
  const confidence = clampConfidence(input.confidence)
  if (!input.businessId.trim()) throw new Error('businessId is required.')
  if (!input.source.trim()) throw new Error('Evidence source is required.')
  if (!input.statement.trim()) throw new Error('Evidence statement is required.')
  if (input.metric && (!input.metric.name.trim() || !Number.isFinite(input.metric.value))) throw new Error('Metric name and numeric metric value are required when metric is supplied.')
  const evidence: VentureEvidenceRecord = { ...input, confidence, evidenceId: `evidence_${input.businessId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, createdAt: input.createdAt || new Date().toISOString() }
  await db.memory.create({ data: { key: evidence.evidenceId, category: 'venture_evidence', value: JSON.stringify(evidence) } })
  return evidence
}

export async function getVentureEvidence(businessId: string, limit = 50): Promise<VentureEvidenceRecord[]> {
  if (!businessId.trim()) return []
  const records = await db.memory.findMany({ where: { category: 'venture_evidence', key: { startsWith: evidenceKeyPrefix(businessId) } }, orderBy: { createdAt: 'desc' }, take: Math.max(1, Math.min(100, limit)) })
  return records.map((record) => { try { return JSON.parse(record.value) as VentureEvidenceRecord } catch { return null } }).filter((item): item is VentureEvidenceRecord => item !== null && item.businessId === businessId)
}

export async function recordLaunchVerification(businessId: string, verification: LaunchVerification): Promise<VentureEvidenceRecord> { return recordVentureEvidence({ businessId, kind: 'launch', source: verification.source, statement: verification.statement, confidence: verification.confidence, verified: true, createdAt: verification.verifiedAt }) }

export async function finalizeVerifiedLaunch(businessId: string): Promise<{ applied: boolean; message: string }> {
  const business = (await getPortfolio()).find((item) => item.businessId === businessId)
  if (!business) return { applied: false, message: 'Business not found.' }
  if (business.lifecycle !== 'validated') return { applied: false, message: 'Only validated ventures can transition to launched through the verified launch gate.' }
  const launchEvidence = (await getVentureEvidence(businessId)).find((item) => item.kind === 'launch' && item.verified && item.confidence >= CEO_VENTURE_MANDATE.validationConfidenceMinimum)
  if (!launchEvidence) return { applied: false, message: 'No sufficiently confident verified launch evidence exists.' }
  return { applied: false, message: 'Verified launch is owner-gated by the CEO Venture Mandate.' }
}

export async function evaluateVentureDecision(input: VentureDecisionInput): Promise<VentureDecisionResult> {
  const mandateErrors = validateVentureMandate()
  const business = (await getPortfolio()).find((item) => item.businessId === input.businessId) ?? null
  const reasons = [...mandateErrors]
  if (!business) return { engineVersion: VENTURE_DECISION_ENGINE_VERSION, businessId: input.businessId, lifecycle: null, decision: 'hold', confidence: 0, autonomousEligible: false, irreversibleActionBlocked: true, score: null, reasons: ['Business not found.', ...reasons], scorecard: {} }
  if (input.requestedSpend !== undefined && !spendAllowed(input.requestedSpend, input.monthlyCommittedSpend)) reasons.push('Requested spend exceeds the CEO Venture Mandate guardrail.')

  if (input.opportunity) {
    const opportunity = calculateOpportunityScore(input.opportunity)
    if (opportunity.score < CEO_VENTURE_MANDATE.opportunityScoreMinimum) return { engineVersion: VENTURE_DECISION_ENGINE_VERSION, businessId: business.businessId, lifecycle: business.lifecycle, decision: 'reject', confidence: opportunity.confidence, autonomousEligible: false, irreversibleActionBlocked: true, score: opportunity.score, reasons: [...reasons, 'Opportunity score is below the CEO advance threshold.', ...opportunity.blockingReasons], scorecard: { opportunity } }
    if (opportunity.confidence < CEO_VENTURE_MANDATE.validationConfidenceMinimum) reasons.push('Opportunity evidence confidence is below the CEO validation threshold.')
    if (business.lifecycle === 'proposed') {
      const decision: VentureDecision = opportunity.decisionReady ? 'build' : 'validate'
      const action = evaluateVentureAction(decision, { requestedSpend: input.requestedSpend, monthlyCommittedSpend: input.monthlyCommittedSpend })
      return { engineVersion: VENTURE_DECISION_ENGINE_VERSION, businessId: business.businessId, lifecycle: business.lifecycle, decision, confidence: opportunity.confidence, autonomousEligible: action.allowed && !action.requiresHumanApproval && reasons.length === mandateErrors.length, irreversibleActionBlocked: true, score: opportunity.score, reasons: [...reasons, ...opportunity.blockingReasons, ...(action.reason ? [action.reason] : [])], scorecard: { opportunity } }
    }
  }

  const persistedEvidence = await getVentureEvidence(input.businessId)
  const launchEvidencePresent = persistedEvidence.some((item) => item.kind === 'launch' && item.verified && item.confidence >= CEO_VENTURE_MANDATE.validationConfidenceMinimum)
  if (business.lifecycle === 'validated' && launchEvidencePresent) {
    const action = evaluateVentureAction('launch_ready')
    return { engineVersion: VENTURE_DECISION_ENGINE_VERSION, businessId: business.businessId, lifecycle: business.lifecycle, decision: 'launch_ready', confidence: Math.max(CEO_VENTURE_MANDATE.validationConfidenceMinimum, averageEvidenceConfidence(persistedEvidence)), autonomousEligible: action.allowed && !action.requiresHumanApproval, irreversibleActionBlocked: true, score: null, reasons: ['Verified launch evidence is present; owner approval is still required before public launch.', ...(action.reason ? [action.reason] : [])], scorecard: {} }
  }

  const health = calculateVentureHealth(input.health ?? deriveHealthInput(business, persistedEvidence))
  const decision = deriveLifecycleDecision(business, health)
  const action = evaluateVentureAction(decision, { requestedSpend: input.requestedSpend, monthlyCommittedSpend: input.monthlyCommittedSpend })
  const isTerminal = business.lifecycle === 'retired'
  if (health.confidence < 0.5) reasons.push('Outcome evidence confidence is below the autonomous decision floor.')
  const scaleComplete = scaleEvidenceComplete(persistedEvidence)
  if (decision === 'scale' && !scaleComplete) reasons.push('Scale requires verified conversion-rate and customer-satisfaction metrics; missing metrics block autonomous scaling.')
  if (action.reason) reasons.push(action.reason)
  const autonomousEligible = !isTerminal && mandateErrors.length === 0 && health.confidence >= 0.5 && action.allowed && !action.requiresHumanApproval && !(decision === 'scale' && !scaleComplete)
  return { engineVersion: VENTURE_DECISION_ENGINE_VERSION, businessId: business.businessId, lifecycle: business.lifecycle, decision: (decision === 'scale' && !scaleComplete) ? 'hold' : decision, confidence: health.confidence, autonomousEligible, irreversibleActionBlocked: action.envelope.irreversible, score: health.score, reasons: [...reasons, ...health.blockingReasons], scorecard: { health } }
}

export async function applyAutonomousVentureDecision(result: VentureDecisionResult): Promise<{ applied: boolean; action: VentureDecision; message: string }> {
  const authorization = evaluateVentureAction(result.decision)
  if (!authorization.allowed || authorization.requiresHumanApproval) return { applied: false, action: result.decision, message: authorization.reason ?? `Decision ${result.decision} is outside the autonomous action envelope.` }
  if (!result.autonomousEligible) return { applied: false, action: result.decision, message: 'Decision is not eligible for autonomous application.' }
  const business = (await getPortfolio()).find((item) => item.businessId === result.businessId)
  if (!business) return { applied: false, action: result.decision, message: 'Business not found.' }

  let applied = false
  let message = 'No state change required.'
  if (result.decision === 'optimize' && business.lifecycle === 'scaling') {
    const updated = await updateBusiness(business.businessId, { lifecycle: 'active' })
    applied = !!updated
    message = applied ? 'Business moved from scaling to active for optimization.' : 'Optimization lifecycle update failed.'
  } else if (result.decision === 'experiment') {
    message = 'Business remains under controlled experimentation; the portfolio experiment engine owns the experiment lifecycle.'
  } else {
    message = `Decision ${result.decision} requires additional planning/evidence or is owner-gated.`
  }

  await db.memory.create({ data: { key: `venture_decision_${result.businessId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, category: 'venture_decision_audit', value: JSON.stringify({ engineVersion: result.engineVersion, businessId: result.businessId, decision: result.decision, confidence: result.confidence, applied, message, reasons: result.reasons, createdAt: new Date().toISOString() }) } }).catch(() => undefined)
  return { applied, action: result.decision, message }
}

export async function runAutonomousVentureCycle(): Promise<VentureCycleResult> {
  const businesses = (await getPortfolio()).filter((business) => business.lifecycle !== 'retired')
  const decisions: VentureDecisionResult[] = []
  let applied = 0, held = 0, killed = 0, scaled = 0
  for (const business of businesses) {
    const evidence = await getVentureEvidence(business.businessId)
    const result = await evaluateVentureDecision({ businessId: business.businessId, health: { ...deriveHealthInput(business, evidence), evidence } })
    decisions.push(result)
    if (result.decision === 'hold') held++
    const appliedResult = await applyAutonomousVentureDecision(result)
    if (appliedResult.applied) { applied++; if (result.decision === 'kill') killed++; if (result.decision === 'scale') scaled++ }
  }

  let learning: PortfolioLearningCycleResult | null = null
  try { learning = await runContinuousPortfolioLearningCycle() }
  catch (error) {
    await db.memory.create({ data: { key: `portfolio_learning_cycle_error_${Date.now()}`, category: 'portfolio_learning_cycle_error', value: JSON.stringify({ error: error instanceof Error ? error.message : String(error), createdAt: new Date().toISOString() }) } }).catch(() => undefined)
  }

  return { scanned: businesses.length, evaluated: decisions.length, applied, held, killed, scaled, decisions, learning }
}
