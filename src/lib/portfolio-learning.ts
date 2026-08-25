import { db } from './db'
import { listExperimentPaymentAttribution } from './portfolio-experiment-attribution'
import { completePortfolioExperiment } from './portfolio-experiments'
import { runPortfolioOptimization } from './portfolio-intelligence-engine'
import type { PortfolioExperiment, PortfolioExperimentLearningStatus } from './portfolio-intelligence-types'

type PortfolioOptimizationResult = Awaited<ReturnType<typeof runPortfolioOptimization>>

export interface PortfolioExperimentLearning {
  learningId: string
  experimentId: string
  business: PortfolioExperiment['business']
  metric: string
  status: PortfolioExperimentLearningStatus
  winnerVariant: string | null
  controlRevenue: number
  variantRevenue: number
  controlSampleSize: number
  variantSampleSize: number
  confidence: number
  evidenceIds: string[]
  learnedAt: string
  completed: boolean
}

export interface PortfolioLearningCycleResult {
  measured: boolean
  completedExperiments: PortfolioExperimentLearning[]
  replan: PortfolioOptimizationResult | null
}

function clamp01(value: number): number { return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0 }
function sum(values: number[]): number { return Number(values.reduce((total, value) => total + value, 0).toFixed(2)) }
function parse(value: string): Record<string, unknown> | null { try { return JSON.parse(value) as Record<string, unknown> } catch { return null } }

export async function listRunningPortfolioExperiments(): Promise<PortfolioExperiment[]> {
  const rows = await db.memory.findMany({ where: { category: 'portfolio_intelligence_experiment' }, orderBy: { createdAt: 'asc' }, take: 500 })
  return rows.map((row) => parse(row.value) as PortfolioExperiment | null).filter((item): item is PortfolioExperiment => !!item && item.status === 'running')
}

export async function learnFromPortfolioExperiment(experiment: PortfolioExperiment): Promise<PortfolioExperimentLearning> {
  if (experiment.status !== 'running') throw new Error(`Experiment ${experiment.experimentId} is not running.`)
  const attributions = await listExperimentPaymentAttribution(experiment.experimentId)
  if (!attributions.length) throw new Error(`Experiment ${experiment.experimentId} has no verified payment attribution.`)

  const controlVariant = experiment.controlVariant ?? 'current_baseline'
  const variant = experiment.variant ?? 'autonomous_variant'
  const controlAttributions = attributions.filter((item) => item.variant === controlVariant)
  const variantAttributions = attributions.filter((item) => item.variant === variant)
  const controlRevenue = sum(controlAttributions.map((item) => item.amount))
  const variantRevenue = sum(variantAttributions.map((item) => item.amount))
  const evidenceIds = attributions.map((item) => item.evidenceId)
  const hasBothVariants = controlAttributions.length > 0 && variantAttributions.length > 0

  let status: PortfolioExperimentLearningStatus = 'insufficient_evidence'
  let winnerVariant: string | null = null
  let confidence = 0.25
  if (hasBothVariants) {
    const totalRevenue = controlRevenue + variantRevenue
    const relativeDelta = totalRevenue > 0 ? Math.abs(variantRevenue - controlRevenue) / totalRevenue : 0
    confidence = clamp01(0.5 + Math.min(0.45, (controlAttributions.length + variantAttributions.length) * 0.05) + Math.min(0.05, relativeDelta))
    if (relativeDelta < 0.1) status = 'inconclusive'
    else if (variantRevenue > controlRevenue) { status = 'variant_wins'; winnerVariant = variant }
    else { status = 'control_wins'; winnerVariant = controlVariant }
  }

  const learning: PortfolioExperimentLearning = {
    learningId: `portfolio_learning_${experiment.experimentId}`,
    experimentId: experiment.experimentId,
    business: experiment.business,
    metric: experiment.metric,
    status,
    winnerVariant,
    controlRevenue,
    variantRevenue,
    controlSampleSize: controlAttributions.length,
    variantSampleSize: variantAttributions.length,
    confidence,
    evidenceIds,
    learnedAt: new Date().toISOString(),
    completed: false,
  }

  if (!hasBothVariants) {
    await db.memory.upsert({
      where: { key: learning.learningId },
      update: { value: JSON.stringify(learning), category: 'portfolio_intelligence_learning' },
      create: { key: learning.learningId, value: JSON.stringify(learning), category: 'portfolio_intelligence_learning' },
    })
    return learning
  }

  const completed = await completePortfolioExperiment(experiment.experimentId, {
    observedValue: variantRevenue,
    controlRevenue,
    variantRevenue,
    controlSampleSize: controlAttributions.length,
    variantSampleSize: variantAttributions.length,
    learningStatus: status,
    learningConfidence: confidence,
    learningEvidenceIds: evidenceIds,
  })
  if (!completed) throw new Error(`Experiment ${experiment.experimentId} could not be completed.`)
  learning.completed = true

  await db.memory.upsert({
    where: { key: learning.learningId },
    update: { value: JSON.stringify(learning), category: 'portfolio_intelligence_learning' },
    create: { key: learning.learningId, value: JSON.stringify(learning), category: 'portfolio_intelligence_learning' },
  })

  if (status === 'variant_wins' || status === 'control_wins') {
    await db.memory.upsert({
      where: { key: `portfolio_reallocation:${experiment.business}` },
      update: { value: JSON.stringify({ business: experiment.business, learningId: learning.learningId, preferredVariant: winnerVariant, confidence, evidenceIds, updatedAt: learning.learnedAt }), category: 'portfolio_reallocation' },
      create: { key: `portfolio_reallocation:${experiment.business}`, value: JSON.stringify({ business: experiment.business, learningId: learning.learningId, preferredVariant: winnerVariant, confidence, evidenceIds, updatedAt: learning.learnedAt }), category: 'portfolio_reallocation' },
    })
  }

  return learning
}

export async function runContinuousPortfolioLearningCycle(): Promise<PortfolioLearningCycleResult> {
  const baseline = await runPortfolioOptimization()
  const running = await listRunningPortfolioExperiments()
  const completedExperiments: PortfolioExperimentLearning[] = []
  for (const experiment of running) {
    try { completedExperiments.push(await learnFromPortfolioExperiment(experiment)) } catch { /* insufficient verified evidence leaves the experiment running */ }
  }
  const requiresReplan = completedExperiments.some((learning) => learning.completed && ['variant_wins', 'control_wins', 'inconclusive'].includes(learning.status))
  const replan = requiresReplan ? await runPortfolioOptimization() : null
  return { measured: !!baseline.snapshot, completedExperiments, replan }
}
