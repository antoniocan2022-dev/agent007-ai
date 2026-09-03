import { createHash } from 'node:crypto'
import { db } from './db'
import { assertLoopTransition, type LoopStage } from './architecture-integrity-contract'
export type ContinuousLoopStatus = 'ACTIVE' | 'AWAITING_APPROVAL' | 'COMPLETED' | 'BLOCKED'
export interface LoopTransitionRecord { from: LoopStage; to: LoopStage; at: string; evidence: string[] }
export interface ContinuousLoopTrace { schemaVersion: 1; loopId: string; recommendationId: string | null; currentStage: LoopStage; status: ContinuousLoopStatus; transitions: LoopTransitionRecord[]; evidence: string[]; createdAt: string; completedAt: string | null }
function loopIdFor(recommendationId: string | null, seed: string): string { const digest = createHash('sha256').update(recommendationId?.trim() ? `recommendation|${recommendationId.trim()}` : `seed|${seed}`).digest('hex').slice(0, 24); return `continuous_loop_${digest}` }
export function buildContinuousLoopTrace(input: { recommendationId?: string | null; startStage?: LoopStage; evidence?: string[]; createdAt?: string }): ContinuousLoopTrace { const createdAt = input.createdAt ?? new Date().toISOString(); return { schemaVersion: 1, loopId: loopIdFor(input.recommendationId ?? null, createdAt), recommendationId: input.recommendationId ?? null, currentStage: input.startStage ?? 'PERCEIVE', status: 'ACTIVE', transitions: [], evidence: [...new Set((input.evidence ?? []).map((item) => item.trim()).filter(Boolean))], createdAt, completedAt: null } }
export function advanceContinuousLoop(trace: ContinuousLoopTrace, to: LoopStage, evidence: string[] = []): ContinuousLoopTrace { if (trace.status === 'COMPLETED' || trace.status === 'BLOCKED') throw new Error(`Continuous loop is terminal (${trace.status}).`); assertLoopTransition(trace.currentStage, to); const transition: LoopTransitionRecord = { from: trace.currentStage, to, at: new Date().toISOString(), evidence: [...new Set(evidence.map((item) => item.trim()).filter(Boolean))] }; return { ...trace, currentStage: to, transitions: [...trace.transitions, transition], evidence: [...new Set([...trace.evidence, ...transition.evidence])] } }
export function completeContinuousLoop(trace: ContinuousLoopTrace, finalEvidence: string[] = []): ContinuousLoopTrace { if (trace.status !== 'ACTIVE' && trace.status !== 'AWAITING_APPROVAL') throw new Error(`Continuous loop cannot complete from ${trace.status}.`); if (trace.currentStage === 'REGRESSION_TEST') trace = advanceContinuousLoop(trace, 'CONTINUE', finalEvidence); if (trace.currentStage !== 'CONTINUE') throw new Error(`Continuous loop cannot complete from ${trace.currentStage}.`); return { ...trace, status: 'COMPLETED', completedAt: new Date().toISOString(), evidence: [...new Set([...trace.evidence, ...finalEvidence])] } }
export async function startContinuousLoop(input: { recommendationId?: string | null; evidence?: string[] }): Promise<ContinuousLoopTrace> { const trace = buildContinuousLoopTrace(input); const key = `continuous_loop:${trace.loopId}`; await db.memory.upsert({ where: { key }, create: { key, value: JSON.stringify(trace), category: 'continuous_loop_trace' }, update: { value: JSON.stringify(trace), category: 'continuous_loop_trace' } }); return trace }
export async function advancePersistedContinuousLoop(loopId: string, to: LoopStage, evidence: string[] = []): Promise<ContinuousLoopTrace> { const key = `continuous_loop:${loopId}`; const row = await db.memory.findUnique({ where: { key } }); if (!row) throw new Error(`Continuous loop not found: ${loopId}`); const trace = advanceContinuousLoop(JSON.parse(row.value) as ContinuousLoopTrace, to, evidence); await db.memory.update({ where: { key }, data: { value: JSON.stringify(trace) } }); return trace }
export async function getContinuousLoop(loopId: string): Promise<ContinuousLoopTrace | null> { const row = await db.memory.findUnique({ where: { key: `continuous_loop:${loopId}` } }); return row ? JSON.parse(row.value) as ContinuousLoopTrace : null }
export async function runGovernedEvolutionCycle(): Promise<{ cycleId: string; status: 'AWAITING_APPROVAL' | 'COMPLETED'; observed: { orgIQ: number; missionCount: number; trend: string }; proposals: string[]; simulated: string[]; awaitingApproval: string[] }> {
  const { generateHealthReport } = await import('./evolution-engine')
  const { createInitiative, simulateInitiative, findUnresolvedInitiative, listInitiativesByStatus } = await import('./closed-loop-improvement')
  const report = await generateHealthReport()
  const actionable = report.recommendations.filter((recommendation) => !/organization is healthy|all metrics within acceptable ranges/i.test(recommendation))
  const proposals: string[] = []
  const simulated: string[] = []
  for (const recommendation of actionable) {
    const lower = recommendation.toLowerCase()
    const metric = lower.includes('duration') || lower.includes('slow missions') ? 'duration' : lower.includes('correction') || lower.includes('template') ? 'corrections' : lower.includes('verification') ? 'verificationScore' : lower.includes('error') || lower.includes('self-healing') ? 'errors' : lower.includes('tool') ? 'tools' : 'confidence'
    const direction = ['duration', 'corrections', 'errors', 'tools'].includes(metric) ? 'decrease' as const : 'increase' as const
    const existing = await findUnresolvedInitiative(recommendation, metric)
    const initiative = existing ?? await createInitiative(recommendation, 'evolution_engine', metric, direction)
    proposals.push(initiative.initiativeId)
    if (initiative.status === 'proposed') { const simulation = await simulateInitiative(initiative.initiativeId); if (simulation.simulation.ok) simulated.push(initiative.initiativeId) } else if (initiative.status === 'simulated') simulated.push(initiative.initiativeId)
  }
  const awaitingApproval = await listInitiativesByStatus('simulated', 100)
  const cycleId = `governed_evolution_${Date.now()}`
  await db.memory.create({ data: { key: cycleId, value: JSON.stringify({ schemaVersion: 1, cycleId, observed: report.orgIQ, proposals, simulated, awaitingApproval: awaitingApproval.map((item) => item.initiativeId) }), category: 'governed_evolution_cycle' } })
  return { cycleId, status: awaitingApproval.length ? 'AWAITING_APPROVAL' : 'COMPLETED', observed: { orgIQ: report.orgIQ.totalScore, missionCount: report.missionStats.total24h, trend: report.orgIQ.trend }, proposals, simulated, awaitingApproval: awaitingApproval.map((item) => item.initiativeId) }
}
