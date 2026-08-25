import { db } from './db'
import { CEO_VENTURE_MANDATE, isSpendWithinGuardrail } from './venture-mandate'
import type { PortfolioExperiment, PortfolioExperimentStatus } from './portfolio-intelligence-types'
import type { PortfolioBusiness } from './portfolio-intelligence-contract'

const transitions: Record<PortfolioExperimentStatus, readonly PortfolioExperimentStatus[]> = {
  proposed: ['approved', 'rejected'],
  approved: ['running', 'rejected'],
  running: ['completed'],
  completed: [],
  rejected: [],
}

function parseExperiment(value: string): PortfolioExperiment | null {
  try { return JSON.parse(value) as PortfolioExperiment } catch { return null }
}

export async function createPortfolioExperiment(input: Omit<PortfolioExperiment, 'experimentId' | 'createdAt' | 'status'>): Promise<PortfolioExperiment> {
  if (input.budget < 0 || !Number.isFinite(input.budget)) throw new Error('Experiment budget must be non-negative.')
  if (input.budget > CEO_VENTURE_MANDATE.maximumSingleSpendWithoutApproval) throw new Error('Experiment budget exceeds autonomous spend guardrail.')
  const id = `portfolio_experiment_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const experiment: PortfolioExperiment = { ...input, experimentId: id, createdAt: new Date().toISOString(), status: 'proposed' }
  await db.memory.create({ data: { key: id, category: 'portfolio_intelligence_experiment', value: JSON.stringify(experiment) } })
  return experiment
}

export async function transitionPortfolioExperiment(experimentId: string, status: PortfolioExperimentStatus): Promise<PortfolioExperiment | null> {
  const row = await db.memory.findFirst({ where: { key: experimentId, category: 'portfolio_intelligence_experiment' } })
  if (!row) return null
  const current = parseExperiment(row.value)
  if (!current) return null
  if (!transitions[current.status].includes(status)) throw new Error(`Invalid experiment transition: ${current.status} -> ${status}`)
  if (status === 'running' && !isSpendWithinGuardrail(current.budget, 0)) throw new Error('Experiment cannot run outside the CEO spend guardrail.')
  const next = { ...current, status }
  await db.memory.update({ where: { id: row.id }, data: { value: JSON.stringify(next) } })
  return next
}

export interface ActivatePortfolioExperimentInput {
  business: PortfolioBusiness
  decisionId: string
  hypothesis: string
  metric: string
  baseline: number
  target: number
  budget?: number
}

export async function activatePortfolioExperiment(input: ActivatePortfolioExperimentInput): Promise<PortfolioExperiment> {
  if (!input.decisionId.trim()) throw new Error('decisionId is required to activate an experiment.')
  if (!input.hypothesis.trim()) throw new Error('Experiment hypothesis is required.')
  if (!input.metric.trim()) throw new Error('Experiment metric is required.')
  const rows = await db.memory.findMany({ where: { category: 'portfolio_intelligence_experiment' }, orderBy: { createdAt: 'desc' }, take: 200 })
  for (const row of rows) {
    const existing = parseExperiment(row.value)
    if (!existing) continue
    if (existing.decisionId === input.decisionId && ['proposed', 'approved', 'running'].includes(existing.status)) return existing
  }

  const budget = input.budget ?? 0
  const experiment = await createPortfolioExperiment({
    business: input.business,
    hypothesis: input.hypothesis,
    metric: input.metric,
    baseline: Number.isFinite(input.baseline) ? input.baseline : 0,
    target: Number.isFinite(input.target) ? input.target : input.baseline,
    budget,
    decisionId: input.decisionId,
    controlVariant: 'current_baseline',
    variant: `autonomous_variant_${input.decisionId.slice(-8)}`,
  })

  const approved = await transitionPortfolioExperiment(experiment.experimentId, 'approved')
  if (!approved) throw new Error('Experiment approval state could not be persisted.')
  const running = await transitionPortfolioExperiment(approved.experimentId, 'running')
  if (!running) throw new Error('Experiment running state could not be persisted.')
  return running
}
