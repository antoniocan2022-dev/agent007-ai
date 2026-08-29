import { inferTaskType } from './canonical-llm-router'
import { classifyExecution } from './adaptive-execution'
import { classifyCeoSelfReflection } from './ceo-self-reflection'
import type { TaskType } from './subagent-governance'
import type {
  CeoExecutionContract,
  CeoIntent,
  EvidenceRequirement,
  ExecutionRequirement,
  OrchestrationOwner,
  PreRouteDecision,
} from './ceo-cognitive-contract'

const SIMPLE_RE = /^(what is|what's|who is|where is|when is|how much|how many|define|meaning of|translate|calculate)\b/i
const CONTEXT_RE = /\b(this|that|these|those|it|they|them|above|previous|prior|continue|again|same|more|also|instead|as before)\b/i
const DIRECT_CEO_MAX_CHARS = 1200

function latestUserText(messages: readonly { role: string; content: string }[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return String(messages[index].content ?? '').trim()
  }
  return ''
}

function buildExecutionContract(input: {
  intent: CeoIntent
  evidenceRequirement: EvidenceRequirement
  executionRequirement: ExecutionRequirement
  orchestrationOwner: OrchestrationOwner
  maxTurns: number
  maxRecoveries: number
  latencyBudgetMs: number
  toolRequired: boolean
  subagentsRequired: boolean
  reason: string
}): CeoExecutionContract {
  return { ...input }
}

function contractFor(input: {
  intent: CeoIntent
  adaptiveExecutionClass: 'fast' | 'standard' | 'deep' | 'mission'
  missionRelevant: boolean
  reason: string
}): CeoExecutionContract {
  const { intent, adaptiveExecutionClass, missionRelevant, reason } = input

  if (intent === 'self_assessment') {
    return buildExecutionContract({
      intent,
      evidenceRequirement: 'internal_state',
      executionRequirement: 'llm_only',
      orchestrationOwner: 'ceo_lifecycle',
      maxTurns: 2,
      maxRecoveries: 0,
      latencyBudgetMs: 30000,
      toolRequired: false,
      subagentsRequired: false,
      reason,
    })
  }

  if (intent === 'conversation') {
    return buildExecutionContract({
      intent,
      evidenceRequirement: 'none',
      executionRequirement: 'llm_only',
      orchestrationOwner: 'ceo_lifecycle',
      maxTurns: 1,
      maxRecoveries: 0,
      latencyBudgetMs: 15000,
      toolRequired: false,
      subagentsRequired: false,
      reason,
    })
  }

  if (intent === 'analysis' || intent === 'opinion' || intent === 'decision') {
    return buildExecutionContract({
      intent,
      evidenceRequirement: 'none',
      executionRequirement: 'llm_only',
      orchestrationOwner: 'ceo_lifecycle',
      maxTurns: adaptiveExecutionClass === 'deep' ? 2 : 1,
      maxRecoveries: 0,
      latencyBudgetMs: adaptiveExecutionClass === 'deep' ? 30000 : 15000,
      toolRequired: false,
      subagentsRequired: false,
      reason,
    })
  }

  // Explicit operational intent always outranks adaptive complexity.
  if (intent === 'production_action') {
    return buildExecutionContract({
      intent,
      evidenceRequirement: 'live_system',
      executionRequirement: 'production',
      orchestrationOwner: 'operational_orchestrator',
      maxTurns: 6,
      maxRecoveries: 1,
      latencyBudgetMs: 60000,
      toolRequired: true,
      subagentsRequired: false,
      reason,
    })
  }

  if (intent === 'research') {
    return buildExecutionContract({
      intent,
      evidenceRequirement: 'external_web',
      executionRequirement: 'one_tool',
      orchestrationOwner: 'operational_orchestrator',
      maxTurns: adaptiveExecutionClass === 'deep' ? 6 : 4,
      maxRecoveries: 1,
      latencyBudgetMs: adaptiveExecutionClass === 'deep' ? 60000 : 30000,
      toolRequired: true,
      subagentsRequired: false,
      reason,
    })
  }

  if (intent === 'tool_action') {
    return buildExecutionContract({
      intent,
      evidenceRequirement: 'internal_state',
      executionRequirement: 'one_tool',
      orchestrationOwner: 'operational_orchestrator',
      maxTurns: adaptiveExecutionClass === 'deep' ? 6 : 4,
      maxRecoveries: 1,
      latencyBudgetMs: adaptiveExecutionClass === 'deep' ? 60000 : 30000,
      toolRequired: true,
      subagentsRequired: false,
      reason,
    })
  }

  if (missionRelevant || adaptiveExecutionClass === 'mission') {
    return buildExecutionContract({
      intent: 'mission_action',
      evidenceRequirement: 'multi_source',
      executionRequirement: 'mission',
      orchestrationOwner: 'operational_orchestrator',
      maxTurns: 12,
      maxRecoveries: 2,
      latencyBudgetMs: 60000,
      toolRequired: true,
      subagentsRequired: true,
      reason,
    })
  }

  return buildExecutionContract({
    intent,
    evidenceRequirement: 'internal_state',
    executionRequirement: 'one_tool',
    orchestrationOwner: 'operational_orchestrator',
    maxTurns: adaptiveExecutionClass === 'deep' ? 6 : 4,
    maxRecoveries: 1,
    latencyBudgetMs: adaptiveExecutionClass === 'deep' ? 60000 : 30000,
    toolRequired: true,
    subagentsRequired: false,
    reason,
  })
}

function inferSemanticIntent(text: string): CeoIntent {
  // Shared classifier owns CEO self-reflection semantics. It deliberately
  // yields `none` for operational/research/mission requests so those lanes
  // retain precedence over reflective interpretation.
  const selfReflection = classifyCeoSelfReflection(text)
  if (selfReflection.isSelfReflective) return 'self_assessment'
  if (/\b(?:deploy|publish|production|ship|launch)\b/i.test(text)) return 'production_action'
  if (/\b(?:mission|autonom(?:y|ous)|venture|revenue|transaction)\b/i.test(text) && /\b(?:run|start|execute|manage|launch|create|fix|implement)\b/i.test(text)) return 'mission_action'
  if (/\b(?:research|search|look\s+up|find\s+(?:out|information)|verify|validate)\b/i.test(text)) return 'research'
  if (/\b(?:create|delete|edit|update|change|schedule|send|run|execute|fix)\b/i.test(text)) return 'tool_action'
  if (/\b(?:should|recommend|recommendation|choose|pick|decision)\b/i.test(text)) return 'decision'
  if (/\b(?:think|opinion|take on|agree|disagree|feel)\b/i.test(text)) return 'opinion'
  if (/\b(?:analy[sz]e|assess|evaluate|review|diagnose|compare|strategy|strategic|root\s+cause)\b/i.test(text)) return 'analysis'
  if (/^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening)|thanks|thank\s+you|ok|okay|great|perfect)\b/i.test(text)) return 'conversation'
  return 'conversation'
}

function buildDecision(input: {
  route: PreRouteDecision['route']
  reason: string
  missionRelevant: boolean
  complexitySignals: number
  taskClass?: TaskType
  adaptiveExecutionClass: 'fast' | 'standard' | 'deep' | 'mission'
  executionContract: CeoExecutionContract
}): PreRouteDecision {
  return input
}

export function preRouteCeoRequest(
  messages: readonly { role: string; content: string }[],
  attachmentsCount = 0,
): PreRouteDecision {
  const text = latestUserText(messages).replace(/\s+/g, ' ').trim()
  const adaptive = classifyExecution(messages)
  const taskClass = inferTaskType(messages)
  const semanticIntent = inferSemanticIntent(text)
  const explicitlyOperational = semanticIntent === 'production_action' || semanticIntent === 'tool_action' || semanticIntent === 'research' || semanticIntent === 'mission_action'

  if (!text) {
    const reason = 'No substantive request detected.'
    return buildDecision({
      route: 'fast', reason, missionRelevant: false, complexitySignals: 0, taskClass,
      adaptiveExecutionClass: 'fast',
      executionContract: contractFor({ intent: 'conversation', adaptiveExecutionClass: 'fast', missionRelevant: false, reason }),
    })
  }

  // Adaptive classification may mark complex language as mission/deep. The
  // canonical self-reflection classifier has already been applied above, so
  // self-assessment takes a bounded CEO path instead of deep orchestration.
  const missionRelevant = semanticIntent === 'mission_action' || (adaptive.executionClass === 'mission' && !explicitlyOperational)
  const complexitySignals = [
    adaptive.executionClass === 'deep' || adaptive.executionClass === 'mission',
    text.length > DIRECT_CEO_MAX_CHARS,
    /\b(and|then|because|including|with|plus)\b/i.test(text),
  ].filter(Boolean).length

  if (attachmentsCount > 0) {
    const reason = 'Attachments require contextual inspection and cannot use the direct CEO conversational lane.'
    return buildDecision({
      route: 'full', reason, missionRelevant, complexitySignals, taskClass,
      adaptiveExecutionClass: adaptive.executionClass,
      executionContract: contractFor({ intent: semanticIntent, adaptiveExecutionClass: adaptive.executionClass, missionRelevant, reason }),
    })
  }

  if (semanticIntent === 'self_assessment') {
    const reason = 'Self-assessment request: evaluate Agent007/CEO readiness from governed internal state without external action.'
    return buildDecision({
      route: 'fast', reason, missionRelevant: false, complexitySignals, taskClass: 'reasoning',
      adaptiveExecutionClass: 'fast',
      executionContract: contractFor({ intent: 'self_assessment', adaptiveExecutionClass: 'fast', missionRelevant: false, reason }),
    })
  }

  if (CONTEXT_RE.test(text) && !SIMPLE_RE.test(text)) {
    const reason = 'Context-dependent request requires richer conversational analysis.'
    return buildDecision({
      route: 'ambiguous', reason, missionRelevant, complexitySignals, taskClass,
      adaptiveExecutionClass: 'standard',
      executionContract: contractFor({ intent: semanticIntent, adaptiveExecutionClass: 'standard', missionRelevant: false, reason }),
    })
  }

  // Explicit production/tool/research/mission intent outranks adaptive complexity.
  if (semanticIntent === 'production_action' || semanticIntent === 'tool_action' || semanticIntent === 'research' || semanticIntent === 'mission_action') {
    const reason = `Semantic intent ${semanticIntent} requires the operational orchestration owner.`
    return buildDecision({
      route: 'full', reason, missionRelevant, complexitySignals, taskClass,
      adaptiveExecutionClass: adaptive.executionClass,
      executionContract: contractFor({ intent: semanticIntent, adaptiveExecutionClass: adaptive.executionClass, missionRelevant, reason }),
    })
  }

  if (semanticIntent === 'conversation' || semanticIntent === 'opinion' || semanticIntent === 'decision' || semanticIntent === 'analysis') {
    const reason = semanticIntent === 'analysis'
      ? 'Semantic analysis request remains CEO-owned; depth changes reasoning strategy, not orchestration ownership.'
      : 'Non-operational executive request remains CEO-owned.'
    const isDeep = adaptive.executionClass === 'deep' || text.length > DIRECT_CEO_MAX_CHARS
    return buildDecision({
      route: isDeep ? 'full' : 'fast', reason, missionRelevant: false, complexitySignals, taskClass,
      adaptiveExecutionClass: adaptive.executionClass,
      executionContract: contractFor({ intent: semanticIntent, adaptiveExecutionClass: isDeep ? 'deep' : 'fast', missionRelevant: false, reason }),
    })
  }

  const reason = 'Request requires the standard governed path.'
  return buildDecision({
    route: 'ambiguous', reason, missionRelevant, complexitySignals, taskClass,
    adaptiveExecutionClass: 'standard',
    executionContract: contractFor({ intent: semanticIntent, adaptiveExecutionClass: 'standard', missionRelevant, reason }),
  })
}

export function resolvePreRoute(decision: PreRouteDecision): Exclude<PreRouteDecision['route'], 'ambiguous'> {
  return decision.route === 'fast' ? 'fast' : 'full'
}
