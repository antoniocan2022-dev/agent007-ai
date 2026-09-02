import type { DecisionPlan, ExecutionPlan, ExecutionStage } from './ceo-cognitive-contract'
import { buildCeoOperatorPlan } from './ceo-operator-intelligence'

export function buildCeoExecutionPlan(decision: DecisionPlan): ExecutionPlan {
  const stages: ExecutionStage[] = [{ name: 'primary', purpose: 'Produce the best governed first-pass answer for the objective.' }]
  if (decision.reasoningStrategy === 'multi_pass') stages.push({ name: 'refinement', purpose: 'Review the draft for missing requirements and materially improve it.' })
  else if (decision.reasoningStrategy === 'independent_review') {
    stages.push({ name: 'independent_review', purpose: 'Challenge the primary answer for unsupported claims, omissions, and contradictions.' })
    stages.push({ name: 'synthesis', purpose: 'Reconcile the primary answer and independent review into the final response.' })
  }
  const operatorPlan = buildCeoOperatorPlan({ contract: decision.executionContract, objective: decision.objective })
  return { requestId: decision.requestId, path: decision.path, reasoningStrategy: decision.reasoningStrategy, stages, maxEscalations: decision.maxEscalations, maxProviderAttempts: decision.maxProviderAttempts, operatorPlan }
}