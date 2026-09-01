import { db } from './db'
import { getPortfolio } from './business-portfolio'
import { evaluateVentureDecision, type VentureDecisionResult } from './venture-decision-engine'
import { getVenture, getVentureCommercialSnapshot, type VentureCommercialSnapshot } from './venture-commercial-foundation'
import { calculateOperationalKpis, type OperationalKpiSnapshot } from './operational-kpi-engine'

export interface CeoVentureState {
  ventureId: string
  venture: Awaited<ReturnType<typeof getVenture>>
  commercial: VentureCommercialSnapshot | null
  kpi: OperationalKpiSnapshot | null
  decision: VentureDecisionResult | null
  operationCheckpoint: Record<string, unknown> | null
}

export function extractVentureId(objective: string): string | null {
  const match = objective.match(/\bventure(?:[_ -])?(\d{3})\b/i)
  return match ? `venture_${match[1]}` : null
}

function parseCheckpoint(value: string | null): Record<string, unknown> | null {
  if (!value) return null
  try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null } catch { return null }
}
function normalizeName(value: string): string { return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase() }

async function readCanonicalVentureDecision(venture: Awaited<ReturnType<typeof getVenture>>): Promise<VentureDecisionResult | null> {
  if (!venture) return null
  const businesses = await getPortfolio()
  const exact = businesses.find((business) => business.businessId === venture.id || business.businessId === venture.ventureKey)
  const byName = exact ?? businesses.find((business) => normalizeName(business.name) === normalizeName(venture.name))
  if (!byName) return null
  return evaluateVentureDecision({ businessId: byName.businessId })
}

export async function readCeoVentureState(ventureId: string): Promise<CeoVentureState> {
  const normalized = ventureId.trim().toLowerCase()
  if (!/^venture_\d{3}$/.test(normalized)) throw new Error(`Invalid venture identifier: ${ventureId}`)
  const venture = await getVenture(normalized)
  if (!venture) throw new Error(`Venture not found: ${normalized}.`)
  const [commercial, kpi, decision, checkpointRow] = await Promise.all([
    getVentureCommercialSnapshot(normalized),
    calculateOperationalKpis(normalized, 24),
    readCanonicalVentureDecision(venture),
    db.memory.findUnique({ where: { key: `venture-os:operation:${normalized}` }, select: { value: true } }),
  ])
  return { ventureId: normalized, venture, commercial, kpi, decision, operationCheckpoint: parseCheckpoint(checkpointRow?.value ?? null) }
}

function money(value: number): string { return Number.isFinite(value) ? value.toFixed(2) : 'unavailable' }
export function formatCeoVentureEvidence(state: CeoVentureState): string {
  const venture = state.venture, commercial = state.commercial, kpi = state.kpi, decision = state.decision, checkpoint = state.operationCheckpoint
  return [
    `SOURCE: Agent007 live Venture OS read path; venture=${state.ventureId}; read-only evidence.`,
    `IDENTITY: name=${venture?.name ?? 'unknown'}; status=${venture?.status ?? 'unknown'}; productionState=${venture?.productionState ?? 'unknown'}; owner=${venture?.ownerUserId ?? 'unknown'}.`,
    commercial ? `COMMERCIAL: customers=${commercial.customers}; opportunities=${commercial.opportunities}; transactions=${commercial.transactions}; succeededRevenue=${money(commercial.grossTransactionRevenue)}; paidInvoices=${commercial.paidInvoices}; openInvoices=${commercial.openInvoices}; activeSubscriptions=${commercial.activeSubscriptions}.` : 'COMMERCIAL: unavailable.',
    kpi ? `KPI_24H: transactions=${kpi.outcomes.transactions}; grossRevenue=${money(kpi.outcomes.grossRevenue)}; refunds=${money(kpi.outcomes.refunds)}; netRevenue=${money(kpi.outcomes.netRevenue)}; readiness=${kpi.readiness.status}; readinessScore=${kpi.readiness.score}; syntheticRevenueDetected=${kpi.controlHealth.syntheticRevenueDetected}; autonomy=${kpi.autonomy.mode}; leaseHealthy=${kpi.autonomy.leaseHealthy}.` : 'KPI_24H: unavailable.',
    decision ? `CANONICAL_DECISION: decision=${decision.decision}; confidence=${decision.confidence.toFixed(3)}; score=${decision.score ?? 'unavailable'}; autonomousEligible=${decision.autonomousEligible}; irreversibleActionBlocked=${decision.irreversibleActionBlocked}; reasons=${decision.reasons.length ? decision.reasons.join(' | ') : 'none'}.` : 'CANONICAL_DECISION: unavailable because no canonical portfolio-business mapping is established for this venture.',
    checkpoint ? `OPERATION_CHECKPOINT: cycleId=${String(checkpoint.cycleId ?? 'unknown')}; heartbeatAt=${String(checkpoint.updatedAt ?? 'unknown')}; mode=${String(checkpoint.mode ?? 'unknown')}; readiness=${String(checkpoint.readiness ?? 'unknown')}; status=${String(checkpoint.status ?? 'unknown')}.` : 'OPERATION_CHECKPOINT: no persisted checkpoint available.',
    'TRUTH RULE: these values are system evidence, not generated assumptions. Missing values must remain unknown; do not infer revenue, readiness, customer success, decision, or launch approval from absent data.',
  ].join('\n')
}

const CASUAL_ONLY_RE = /^(?:(?:hi|hello|hey)[\s,!.?]+)?(?:hi|hello|hey|good\s+(?:morning|afternoon|evening)|thanks?|thank\s+you|ok(?:ay)?|great|perfect|how\s+(?:are|is)\s+(?:you|everything|things?|agent007|the\s+(?:system|ceo|agent))(?:\s+doing)?|how\s+do\s+you\s+do)[\s,!.?]*$/i
const CONVERSATION_ONLY_RE = /^(?:what'?s\s+new|how'?s\s+it\s+going|what\s+are\s+you\s+up\s+to)[\s,!.?]*$/i
function isConversationOnlyObjective(objective: string): boolean {
  const text = objective.trim()
  if (!text) return false
  if (extractVentureId(text)) return false
  if (CASUAL_ONLY_RE.test(text) || CONVERSATION_ONLY_RE.test(text)) return true
  return !/[?]/.test(text) && /\b(?:thanks|thank\s+you|great|perfect|nice|awesome|sounds\s+good|good\s+job|well\s+done)\b/i.test(text)
}

export async function getCeoVentureEvidenceForObjective(objective: string): Promise<{ ventureId: string; evidence: string } | null> {
  if (isConversationOnlyObjective(objective)) return null
  const ventureId = extractVentureId(objective)
  if (!ventureId) return null
  const state = await readCeoVentureState(ventureId)
  return { ventureId, evidence: formatCeoVentureEvidence(state) }
}
