import type { CeoExecutionContract, EvidenceState, ExecutionRequirement, ResponseAction } from './ceo-cognitive-contract'
import type { CeoWorldModel } from './ceo-world-model'
import type { ToolSelection } from './ceo-tool-selection'
import type { CeoCuriosityDecision } from './ceo-curiosity'

export type OperatorStatus = 'proposed' | 'approved' | 'executing' | 'completed' | 'blocked' | 'verified'
export interface OperatorTask { id: string; objective: string; dependencies: string[]; status: OperatorStatus }
export interface OperatorPlan { schemaVersion: 1; decision: string; objective: string; tasks: OperatorTask[]; executionRequirement: ExecutionRequirement; status: OperatorStatus; completionEvidenceRequired: boolean; verificationRequired: boolean }

export function buildCeoOperatorPlan(input: { contract: CeoExecutionContract; responseAction?: ResponseAction; objective: string; world?: CeoWorldModel; curiosity?: CeoCuriosityDecision; toolSelection?: ToolSelection; approved?: boolean; executionEvidence?: boolean; verificationState?: EvidenceState }): OperatorPlan {
  const executable = input.contract.intent === 'production_action' || input.contract.intent === 'tool_action' || input.contract.intent === 'mission_action' || input.responseAction === 'execute'
  const toolId = input.toolSelection?.selected?.id
  const hasUnresolvedOpenLoop = (input.world?.conversation.data.openLoops.length ?? 0) > 0
  const hasUnaddressedUnknown = input.curiosity?.investigate === true && input.curiosity.materialUnknowns.length > 0
  const dependencies = [
    ...(!input.approved ? ['executive approval'] : []),
    ...(input.contract.toolRequired && !toolId && !input.executionEvidence ? ['capability/tool selection'] : []),
    ...((input.contract.evidenceRequirement !== 'none' && !input.executionEvidence) ? ['evidence acquisition'] : []),
    ...(hasUnresolvedOpenLoop ? ['unresolved open question in this conversation'] : []),
    ...(hasUnaddressedUnknown ? [`unaddressed material unknown: ${input.curiosity!.materialUnknowns[0]}`] : []),
  ]
  const status: OperatorStatus = !executable ? 'proposed' : dependencies.length ? 'blocked' : input.executionEvidence ? (input.verificationState === 'LIVE_VERIFIED' || input.verificationState === 'VERIFIED_CACHED' ? 'verified' : 'completed') : input.approved ? 'approved' : 'proposed'
  return { schemaVersion: 1, decision: input.contract.operation, objective: input.objective, tasks: executable ? [{ id: 'operator.execute', objective: input.objective, dependencies, status }] : [], executionRequirement: input.contract.executionRequirement, status, completionEvidenceRequired: executable, verificationRequired: executable || input.contract.evidenceRequirement !== 'none' }
}
export function canClaimExecution(plan: OperatorPlan): boolean { return plan.status === 'verified' }
export function renderOperatorState(plan: OperatorPlan): string { return `Operator status=${plan.status}; execution claim allowed=${canClaimExecution(plan) ? 'yes' : 'no'}; verification required=${plan.verificationRequired ? 'yes' : 'no'}` }