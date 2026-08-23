import { db } from './db'
import { getVenture, getVentureCommercialSnapshot, type VentureCommercialSnapshot } from './venture-commercial-foundation'
import { calculateOperationalKpis, type OperationalKpiSnapshot } from './operational-kpi-engine'

export interface CeoVentureState {
  ventureId: string
  venture: Awaited<ReturnType<typeof getVenture>>
  commercial: VentureCommercialSnapshot | null
  kpi: OperationalKpiSnapshot | null
  operationCheckpoint: Record<string, unknown> | null
}

export function extractVentureId(objective: string): string | null {
  const match = objective.match(/\bventure_\d{3}\b/i)
  return match ? match[0].toLowerCase() : null
}

function parseCheckpoint(value: string | null): Record<string, unknown> | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

export async function readCeoVentureState(ventureId: string): Promise<CeoVentureState> {
  const normalized = ventureId.trim().toLowerCase()
  if (!/^venture_\d{3}$/.test(normalized)) throw new Error(`Invalid venture identifier: ${ventureId}`)
  const venture = await getVenture(normalized)
  if (!venture) throw new Error(`Venture not found: ${normalized}.`)

  const [commercial, kpi, checkpointRow] = await Promise.all([
    getVentureCommercialSnapshot(normalized),
    calculateOperationalKpis(normalized, 24),
    db.memory.findUnique({ where: { key: `venture-os:operation:${normalized}` }, select: { value: true } }),
  ])

  return { ventureId: normalized, venture, commercial, kpi, operationCheckpoint: parseCheckpoint(checkpointRow?.value ?? null) }
}

function money(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : 'unavailable'
}

export function formatCeoVentureEvidence(state: CeoVentureState): string {
  const venture = state.venture
  const commercial = state.commercial
  const kpi = state.kpi
  const checkpoint = state.operationCheckpoint
  return [
    `SOURCE: Agent007 live Venture OS read path; venture=${state.ventureId}; read-only evidence.`,
    `IDENTITY: name=${venture?.name ?? 'unknown'}; status=${venture?.status ?? 'unknown'}; productionState=${venture?.productionState ?? 'unknown'}; owner=${venture?.ownerUserId ?? 'unknown'}.`,
    commercial ? `COMMERCIAL: customers=${commercial.customers}; opportunities=${commercial.opportunities}; transactions=${commercial.transactions}; succeededRevenue=${money(commercial.grossTransactionRevenue)}; paidInvoices=${commercial.paidInvoices}; openInvoices=${commercial.openInvoices}; activeSubscriptions=${commercial.activeSubscriptions}.` : 'COMMERCIAL: unavailable.',
    kpi ? `KPI_24H: transactions=${kpi.outcomes.transactions}; grossRevenue=${money(kpi.outcomes.grossRevenue)}; refunds=${money(kpi.outcomes.refunds)}; netRevenue=${money(kpi.outcomes.netRevenue)}; readiness=${kpi.readiness.status}; readinessScore=${kpi.readiness.score}; syntheticRevenueDetected=${kpi.controlHealth.syntheticRevenueDetected}; autonomy=${kpi.autonomy.mode}; leaseHealthy=${kpi.autonomy.leaseHealthy}.` : 'KPI_24H: unavailable.',
    checkpoint ? `OPERATION_CHECKPOINT: cycleId=${String(checkpoint.cycleId ?? 'unknown')}; heartbeatAt=${String(checkpoint.updatedAt ?? 'unknown')}; mode=${String(checkpoint.mode ?? 'unknown')}; readiness=${String(checkpoint.readiness ?? 'unknown')}; status=${String(checkpoint.status ?? 'unknown')}.` : 'OPERATION_CHECKPOINT: no persisted checkpoint available.',
    'TRUTH RULE: these values are system evidence, not generated assumptions. Missing values must remain unknown; do not infer revenue, readiness, customer success, or launch approval from absent data.',
  ].join('\n')
}

export async function getCeoVentureEvidenceForObjective(objective: string): Promise<{ ventureId: string; evidence: string } | null> {
  const ventureId = extractVentureId(objective)
  if (!ventureId) return null
  const state = await readCeoVentureState(ventureId)
  return { ventureId, evidence: formatCeoVentureEvidence(state) }
}
