import { inferTaskType } from './canonical-llm-router'
import { classifyExecution } from './adaptive-execution'
import type { PreRouteDecision } from './ceo-cognitive-contract'

const SIMPLE_RE = /^(what is|what's|who is|where is|when is|how much|how many|define|meaning of|translate|calculate)\b/i
const CONTEXT_RE = /\b(this|that|these|those|it|they|them|above|previous|prior|continue|again|same|more|also|instead|as before)\b/i
const DIRECT_CEO_MAX_CHARS = 1200

function latestUserText(messages: readonly { role: string; content: string }[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return String(messages[index].content ?? '').trim()
  }
  return ''
}

export function preRouteCeoRequest(
  messages: readonly { role: string; content: string }[],
  attachmentsCount = 0,
): PreRouteDecision {
  const text = latestUserText(messages).replace(/\s+/g, ' ').trim()
  if (!text) {
    return { route: 'fast', reason: 'No substantive request detected.', missionRelevant: false, complexitySignals: 0, taskClass: 'reasoning', adaptiveExecutionClass: 'fast' }
  }

  const adaptive = classifyExecution(messages)
  const taskClass = inferTaskType(messages)
  const missionRelevant = adaptive.executionClass === 'mission'
  const complexitySignals = [
    adaptive.executionClass === 'deep' || adaptive.executionClass === 'mission',
    text.length > DIRECT_CEO_MAX_CHARS,
    /\b(and|then|because|including|with|plus)\b/i.test(text),
  ].filter(Boolean).length

  if (attachmentsCount > 0) {
    return { route: 'full', reason: 'Attachments require contextual inspection and cannot use the direct CEO lane.', missionRelevant, complexitySignals, taskClass, adaptiveExecutionClass: adaptive.executionClass }
  }
  if (adaptive.executionClass === 'mission' || adaptive.executionClass === 'deep') {
    return { route: 'full', reason: 'Canonical adaptive execution classified the request as deep or mission work.', missionRelevant, complexitySignals, taskClass, adaptiveExecutionClass: adaptive.executionClass }
  }
  if (CONTEXT_RE.test(text) && !SIMPLE_RE.test(text) && text.length > DIRECT_CEO_MAX_CHARS) {
    return { route: 'ambiguous', reason: 'Long context-dependent request requires richer conversational analysis.', missionRelevant, complexitySignals, taskClass, adaptiveExecutionClass: adaptive.executionClass }
  }
  if (text.length <= DIRECT_CEO_MAX_CHARS) {
    return { route: 'fast', reason: 'Bounded direct CEO lane selected to keep ordinary executive conversations responsive.', missionRelevant, complexitySignals, taskClass, adaptiveExecutionClass: adaptive.executionClass }
  }

  return { route: 'ambiguous', reason: 'Request exceeds the bounded direct CEO lane; defaulting to the full path.', missionRelevant, complexitySignals, taskClass, adaptiveExecutionClass: adaptive.executionClass }
}

export function resolvePreRoute(decision: PreRouteDecision): Exclude<PreRouteDecision['route'], 'ambiguous'> {
  return decision.route === 'fast' ? 'fast' : 'full'
}
