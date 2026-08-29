import type { PersistedConversationRow } from './ceo-context-composer'

export interface ContextContinuityScore {
  score: number
  relevantTurnCount: number
  matchedTurnCount: number
  anaphoraDetected: boolean
  understood: boolean
  reasons: string[]
}

export interface ClaimConsistencyResult {
  consistent: boolean
  claims: string[]
  contradictions: Array<{ left: string; right: string; reason: string }>
}

const STOPWORDS = new Set([
  'about', 'after', 'again', 'also', 'because', 'before', 'being', 'between', 'could', 'from',
  'have', 'into', 'more', 'most', 'other', 'should', 'that', 'their', 'there', 'these', 'they',
  'this', 'those', 'through', 'under', 'what', 'when', 'where', 'which', 'while', 'with', 'would',
  'your', 'please', 'then', 'than', 'just', 'like', 'really', 'very', 'doing', 'does', 'dont',
  'you', 'are', 'how', 'why', 'can', 'tell', 'give', 'make', 'want', 'such',
])

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function tokens(value: string): Set<string> {
  return new Set(normalize(value).toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 4 && !STOPWORDS.has(token)))
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let count = 0
  for (const token of a) if (b.has(token)) count += 1
  return count
}

function containsAnaphora(value: string): boolean {
  return /\b(?:this|that|these|those|it|they|them|above|previous|prior|same|again|continue|instead|as before|itself|themself)\b/i.test(value)
}

function recentUserAnchor(prior: readonly PersistedConversationRow[]): string {
  return [...prior].reverse().find((row) => row.role === 'user')?.content ?? ''
}

export function scoreContextContinuity(input: {
  currentUserMessage: string
  response: string
  priorTurns: readonly PersistedConversationRow[]
  relevantOlderMessages?: readonly PersistedConversationRow[]
}): ContextContinuityScore {
  const prior = [...(input.relevantOlderMessages ?? []), ...input.priorTurns].filter((row) => row.role === 'user' || row.role === 'assistant')
  const currentTokens = tokens(input.currentUserMessage)
  const responseTokens = tokens(input.response)
  const anaphoraDetected = containsAnaphora(input.currentUserMessage)
  const anchor = anaphoraDetected ? recentUserAnchor(prior) : input.currentUserMessage
  const anchorTokens = tokens(anchor)
  const candidateRows = anaphoraDetected
    ? prior.slice(-8)
    : prior.map((row) => ({ row, relevance: overlap(currentTokens, tokens(row.content)) })).filter((entry) => entry.relevance > 0).map((entry) => entry.row).slice(-8)
  const relevant = candidateRows.length
    ? candidateRows
    : (anaphoraDetected && anchor ? [prior.find((row) => row.role === 'user' && normalize(row.content) === normalize(anchor)) ?? prior[prior.length - 1]].filter(Boolean) as PersistedConversationRow[] : [])

  if (!relevant.length) {
    return { score: anaphoraDetected ? 40 : 100, relevantTurnCount: 0, matchedTurnCount: 0, anaphoraDetected, understood: !anaphoraDetected, reasons: [anaphoraDetected ? 'Context-dependent wording was used but no prior conversational anchor was available.' : 'No relevant prior turns were detected; continuity was not materially required.'] }
  }

  const historyEvidence = relevant.map((row) => ({ row, relevance: overlap(anchorTokens, tokens(row.content)) })).filter((entry) => entry.relevance > 0)
  const matched = historyEvidence.filter((entry) => overlap(responseTokens, tokens(entry.row.content)) >= Math.min(2, Math.max(1, Math.min(3, entry.relevance)))).length
  const anchorCoverage = anchorTokens.size ? Math.min(1, overlap(anchorTokens, responseTokens) / Math.max(1, Math.min(6, anchorTokens.size))) : 0
  const historyCoverage = historyEvidence.length ? matched / historyEvidence.length : 0
  const recencyWeight = anaphoraDetected && matched > 0 ? 0.15 : 0
  const score = Math.round(Math.max(0, Math.min(100, (anchorCoverage * 0.45 + historyCoverage * 0.4 + recencyWeight) * 100)))
  const reasons: string[] = []
  if (matched > 0) reasons.push('The response is grounded in relevant prior conversational context.')
  else reasons.push('The response did not demonstrate sufficient grounding in the relevant prior context.')
  if (anaphoraDetected) reasons.push(matched > 0 ? 'Context-dependent wording was resolved against a prior conversational anchor.' : 'Context-dependent wording was present but not adequately grounded.')
  return { score, relevantTurnCount: relevant.length, matchedTurnCount: matched, anaphoraDetected, understood: score >= 60, reasons }
}

function sentenceClaims(content: string): string[] {
  return normalize(content).split(/[.!?]+/).map((sentence) => sentence.trim()).filter((sentence) => sentence.length >= 18).slice(0, 120)
}

function polarity(claim: string): 'positive' | 'negative' | 'neutral' {
  const normalized = claim.toLowerCase()
  if (/\b(?:might|may|could|would|possibly|perhaps|likely|unlikely|if|unless|could be)\b/i.test(normalized)) return 'neutral'
  if (/\b(?:must not|should not|do not|does not|did not|cannot|can't|never|no|without|unavailable|failed|unknown|unverified|uncertain)\b/i.test(normalized)) return 'negative'
  if (/\b(?:is|are|was|were|has|have|had|can|will|available|succeeded|proven|confirmed|verified)\b/i.test(normalized) && !/\b(?:is not|are not|was not|were not|has not|have not|had not|cannot|can't)\b/i.test(normalized)) return 'positive'
  return 'neutral'
}

function numericValues(claim: string): string[] {
  return [...claim.toLowerCase().matchAll(/\b\d+(?:\.\d+)?\s*(?:%|percent|ms|seconds?|minutes?|hours?|days?)\b/g)].map((m) => m[0])
}

export function evaluateClaimConsistency(content: string): ClaimConsistencyResult {
  const claims = sentenceClaims(content)
  const contradictions: ClaimConsistencyResult['contradictions'] = []
  const claimTokens = claims.map((claim) => tokens(claim))
  for (let i = 0; i < claims.length; i += 1) {
    for (let j = i + 1; j < claims.length; j += 1) {
      const shared = overlap(claimTokens[i]!, claimTokens[j]!)
      if (shared < 4) continue
      const leftPolarity = polarity(claims[i]!)
      const rightPolarity = polarity(claims[j]!)
      if (leftPolarity !== 'neutral' && rightPolarity !== 'neutral' && leftPolarity !== rightPolarity) {
        contradictions.push({ left: claims[i]!, right: claims[j]!, reason: 'Overlapping claims assert opposing states.' })
        continue
      }
      const leftNumbers = numericValues(claims[i]!)
      const rightNumbers = numericValues(claims[j]!)
      if (leftPolarity !== 'neutral' && rightPolarity !== 'neutral' && leftNumbers.length === 1 && rightNumbers.length === 1 && leftNumbers[0] !== rightNumbers[0]) {
        contradictions.push({ left: claims[i]!, right: claims[j]!, reason: 'Overlapping claims assert incompatible numeric values.' })
      }
    }
  }
  return { consistent: contradictions.length === 0, claims, contradictions: contradictions.slice(0, 12) }
}
