import { inferTaskType } from './canonical-llm-router'
import { classifyExecution } from './adaptive-execution'
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

// Self-assessment is semantic in shape: the owner asks Agent007/CEO to assess
// itself, its readiness, capabilities, weaknesses, or performance. This must
// not be promoted to an external-action path merely because the message also
// contains words such as "analysis", "strategy", or "business".
const SELF_ASSESSMENT_RE = /\b(?:analy[sz]e|assess|evaluate|review|diagnose|reflect|self[-\s]?assessment|self[-\s]?analysis|readiness|ready)\b[\s\S]{0,160}\b(?:you|your|yourself|agent007|ceo)\b|\b(?:you|your|yourself|agent007|ceo)\b[\s\S]{0,160}\b(?:ready|capable|prepared|equipped|weakness(?:es)?|strengths?|performing|manage\s+(?:a\s+)?business(?:es)?|run\s+(?:a\s+)?business(?:es)?)\b/i

const SELF_ASSESSMENT_ACTION_RE = /\b(?:deploy|publish|send|buy|sell|invest|transfer|execute|implement|fix|create|delete|edit|update|change|launch|ship|production)\b/i

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
      latencyBudgetMs: 15000,
      toolRequired: false,
      subagentsRequired: false,
      reason,
    })
  }

  if (intent === 'conversation' || adaptiveExecutionClass === 'fast') {
    return buildExecutionContract({
      intent: intent === 'conversation' ? intent : 'analysis',
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
    evidenceRequirement: intent === 'research' ? 'external_web' : 'none',
    executionRequirement: intent === 'tool_action' ? 'one_tool' : 'llm_only',
    orchestrationOwner: 'operational_orchestrator',
    maxTurns: adaptiveExecutionClass === 'deep' ? 6 : 4,
    maxRecoveries: 1,
    latencyBudgetMs: adaptiveExecutionClass === 'deep' ? 60000 : 30000,
    toolRequired: intent === 'tool_action',
    subagentsRequired: false,
    reason,
  })
}

function inferSemanticIntent(text: string): CeoIntent {
  if (SELF_ASSESSMENT_RE.test(text) && !SELF_ASSESSMENT_ACTION_RE.test(text)) return 'self_assessment'
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
  taskClass?: Parameters<typeof inferTaskType>[0] extends readonly unknown[] ? any : any
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

  if (!text) {
    return buildDecision({
      route: 'fast',
      reason: 'No substantive request detected.',
      missionRelevant: false,
      complexitySignals: 0,
      taskClass,
      adaptiveExecutionClass: 'fast',
      executionContract: contractFor({ intent: 'conversation', adaptiveExecutionClass: 'fast', missionRelevant: false, reason: 'No substantive request detected.' }),
    })
  }

  const missionRelevant = adaptive.executionClass === 'mission' || semanticIntent === 'mission_action'
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

  // Self-assessment takes precedence over generic depth keywords. It is a
  // conversational CEO evaluation unless the owner explicitly requests an
  // external/operational action in the same message.
  if (semanticIntent === 'self_assessment') {
    const reason = 'Self-assessment request: evaluate Agent007/CEO readiness from governed internal state without external action.'
    return buildDecision({
      route: 'fast', reason, missionRelevant: false, complexitySignals, taskClass,
      adaptiveExecutionClass: 'fast',
      executionContract: contractFor({ intent: 'self_assessment', adaptiveExecutionClass: 'fast', missionRelevant: false, reason }),
    })
  }

  if (adaptive.executionClass === 'mission' || semanticIntent === 'mission_action') {
    const reason = 'Mission-level execution requires the operational orchestration owner.'
    return buildDecision({
      route: 'full', reason, missionRelevant: true, complexitySignals, taskClass,
      adaptiveExecutionClass: adaptive.executionClass,
      executionContract: contractFor({ intent: 'mission_action', adaptiveExecutionClass: adaptive.executionClass, missionRelevant: true, reason }),
    })
  }

  if (semanticIntent === 'production_action' || semanticIntent === 'tool_action' || semanticIntent === 'research') {
    const reason = `Semantic intent ${semanticIntent} requires the operational orchestration owner.`
    return buildDecision({
      route: 'full', reason, missionRelevant, complexitySignals, taskClass,
      adaptiveExecutionClass: adaptive.executionClass,
      executionContract: contractFor({ intent: semanticIntent, adaptiveExecutionClass: adaptive.executionClass, missionRelevant, reason }),
    })
  }

  if (CONTEXT_RE.test(text) && !SIMPLE_RE.test(text)) {
    const reason = 'Context-dependent request requires richer conversational analysis.'
    return buildDecision({
      route: 'ambiguous', reason, missionRelevant, complexitySignals, taskClass,
      adaptiveExecutionClass: adaptive.executionClass,
      executionContract: contractFor({ intent: semanticIntent, adaptiveExecutionClass: 'standard', missionRelevant: false, reason }),
    })
  }

  if (text.length <= DIRECT_CEO_MAX_CHARS && adaptive.executionClass !== 'deep') {
    const reason = 'Bounded direct CEO lane selected for a non-operational request.'
    return buildDecision({
      route: 'fast', reason, missionRelevant, complexitySignals, taskClass,
      adaptiveExecutionClass: 'fast',
      executionContract: contractFor({ intent: semanticIntent, adaptiveExecutionClass: 'fast', missionRelevant: false, reason }),
    })
  }

  const reason = 'Request exceeds the bounded direct CEO lane; defaulting to the operational full path.'
  return buildDecision({
    route: 'ambiguous', reason, missionRelevant, complexitySignals, taskClass,
    adaptiveExecutionClass: adaptive.executionClass,
    executionContract: contractFor({ intent: semanticIntent, adaptiveExecutionClass: adaptive.executionClass, missionRelevant, reason }),
  })
}

export function resolvePreRoute(decision: PreRouteDecision): Exclude<PreRouteDecision['route'], 'ambiguous'> {
  return decision.route === 'fast' ? 'fast' : 'full'
}
