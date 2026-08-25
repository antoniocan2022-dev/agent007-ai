import { db } from './db'
import { assertRealSucceededTransaction } from './transaction-evidence-integrity'
import type { PortfolioBusiness } from './portfolio-intelligence-contract'
import type { PortfolioExperimentStatus } from './portfolio-intelligence-types'

export interface ExperimentPaymentAttribution {
  attributionId: string
  experimentId: string
  business: PortfolioBusiness
  variant: string
  transactionId: string
  customerId: string | null
  amount: number
  currency: string
  outcomeType: 'revenue'
  evidenceId: string
  occurredAt: string
}

function parse(value: string): Record<string, any> | null {
  try { return JSON.parse(value) as Record<string, any> } catch { return null }
}

const ATTRIBUTABLE_STATUSES: readonly PortfolioExperimentStatus[] = ['approved', 'running', 'completed']

export async function recordExperimentPaymentAttribution(input: { experimentId: string; business: PortfolioBusiness; variant: string; ventureId: string; transactionId: string; evidenceId: string }): Promise<ExperimentPaymentAttribution> {
  const experimentRow = await db.memory.findFirst({ where: { key: input.experimentId, category: 'portfolio_intelligence_experiment' } })
  if (!experimentRow) throw new Error(`Experiment not found: ${input.experimentId}.`)
  const experiment = parse(experimentRow.value)
  if (!experiment) throw new Error(`Experiment ${input.experimentId} contains malformed state.`)
  if (!ATTRIBUTABLE_STATUSES.includes(experiment.status as PortfolioExperimentStatus)) throw new Error(`Experiment ${input.experimentId} is not in an attributable state.`)
  if (experiment.business !== input.business) throw new Error(`Experiment ${input.experimentId} business scope does not match attribution.`)
  if (!input.variant.trim()) throw new Error('Experiment variant is required for attribution.')

  const verified = await assertRealSucceededTransaction({ ventureId: input.ventureId, transactionId: input.transactionId })
  const attributionId = `experiment_attribution_${input.experimentId}_${verified.id}`
  const record: ExperimentPaymentAttribution = { attributionId, experimentId: input.experimentId, business: input.business, variant: input.variant, transactionId: verified.id, customerId: verified.customerId, amount: verified.amount, currency: verified.currency, outcomeType: 'revenue', evidenceId: input.evidenceId, occurredAt: verified.createdAt }
  await db.memory.upsert({ where: { key: attributionId }, update: { value: JSON.stringify(record), category: 'portfolio_experiment_attribution' }, create: { key: attributionId, category: 'portfolio_experiment_attribution', value: JSON.stringify(record) } })
  return record
}

export async function listExperimentPaymentAttribution(experimentId: string): Promise<ExperimentPaymentAttribution[]> {
  const rows = await db.memory.findMany({ where: { category: 'portfolio_experiment_attribution' }, orderBy: { createdAt: 'asc' }, take: 1000 })
  return rows.map((row) => parse(row.value)).filter((item): item is ExperimentPaymentAttribution => !!item && item.experimentId === experimentId)
}
