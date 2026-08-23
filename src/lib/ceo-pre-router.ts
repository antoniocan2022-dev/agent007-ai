import type { PreRouteDecision } from './ceo-cognitive-contract'

const MISSION_RE = /\b(mission|venture|revenue|customer|production|deploy|launch|publish|purchase|invest|transfer|execute|implement|architecture|security|financial|legal)\b/i
const DEEP_RE = /\b(deep|detailed|comprehensive|compare|comparison|strategy|strategic|architecture|analy[sz]e|diagnose|research|evidence|verify|verification|evaluate|plan|design|security|financial|legal|optimi[sz]e|root\s+cause|audit)\b/i
const SIMPLE_RE = /^(what is|what's|who is|where is|when is|how much|how many|define|meaning of|translate|calculate)\b/i
const CONTEXT_RE = /\b(this|that|these|those|it|they|them|above|previous|prior|continue|again|same|more|also|instead|as before)\b/i

function latestUserText(messages: readonly { role: string; content: string }[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) if (messages[i]?.role === 'user') return String(messages[i]?.content ?? '').trim()
  return ''
}

export function preRouteCeoRequest(messages: readonly { role: string; content: string }[], attachmentsCount = 0): PreRouteDecision {
  const text = latestUserText(messages).replace(/\s+/g, ' ').trim()
  if (!text) return { route: 'fast', reason: 'No substantive request detected.', missionRelevant: false, complexitySignals: 0 }

  const missionRelevant = MISSION_RE.test(text)
  const complexitySignals = [DEEP_RE.test(text), text.length > 800, /\b(and|then|because|including|with|plus)\b/i.test(text)].filter(Boolean).length

  if (attachmentsCount > 0) return { route: 'full', reason: 'Attachments require contextual inspection and cannot use the zero-overhead fast lane.', missionRelevant, complexitySignals }
  if (missionRelevant || complexitySignals >= 2) return { route: 'full', reason: 'Mission, execution, risk, or high-complexity signals detected.', missionRelevant, complexitySignals }
  if (CONTEXT_RE.test(text) && !SIMPLE_RE.test(text)) return { route: 'ambiguous', reason: 'Context-dependent request requires richer conversational analysis.', missionRelevant, complexitySignals }
  if (SIMPLE_RE.test(text) && text.length <= 220) return { route: 'fast', reason: 'Short informational request matches deterministic fast-path patterns.', missionRelevant, complexitySignals }
  if (text.length <= 280 && !DEEP_RE.test(text)) return { route: 'fast', reason: 'Short request without deep-work indicators.', missionRelevant, complexitySignals }
  return { route: 'ambiguous', reason: 'Request is not safely classifiable as fast; defaulting to the full path.', missionRelevant, complexitySignals }
}

export function resolvePreRoute(decision: PreRouteDecision): Exclude<PreRouteDecision['route'], 'ambiguous'> {
  return decision.route === 'fast' ? 'fast' : 'full'
}
