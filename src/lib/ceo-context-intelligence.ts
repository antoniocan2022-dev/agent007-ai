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
  'you', 'are', 'how', 'why', 'can', 'tell', 'give', 'make', 'want', 'into', 'from', 'such',
])

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function tokens(value: string): Set<string> {
  return new Set(
    normalize(value).toLowerCase().split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4 && !STOPWORDS.has(token)),
  )
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let count = 0
  for (const token of a) if (b.has(token)) count += 1
  return count
}

function containsAnaphora(value: string): boolean {
  return /\b(?:this|that|these|those|it|they|them|above|previous|prior|same|again|continue|instead|as before)\b/i.test(value)
}

/**
 * Scores whether the generated response appears to have used relevant prior
 * conversation. This is intentionally a diagnostic score, not evidence and
 * not an authority signal.
 */
export function scoreContextContinuity(input: {
  currentUserMessage: string
  response: string
  priorTurns: readonly PersistedConversationRow[]
  relevantOlderMessages?: readonly PersistedConversationRow[]
}): ContextContinuityScore {
  const prior = [...(input.relevantOlderMessages ?? []), ...input.priorTurns]
    .filter((row) => row.role === 'user' || row.role === 'assistant')
  const currentTokens = tokens(input.currentUserMessage)
  const responseTokens = tokens(input.response)
  const anaphoraDetected = containsAnaphora(input.currentUserMessage)

  const relevant = prior
    .map((row) => ({ row, relevance: overlap(currentTokens, tokens(row.content)) }))
    .filter((entry) => entry.relevance > 0)
    .slice(-8)
  const matched = relevant.filter((entry) => overlap(responseTokens, tokens(entry.row.content)) >= Math.min(3, Math.max(1, entry.relevance))).length

  if (!relevant.length) {
    return { score: 100, relevantTurnCount: 0, matchedTurnCount: 0, anaphoraDetected, understood: true, reasons: ['No relevant prior turns were detected; continuity was not materially required.'] }
  }

  const directCoverage = currentTokens.size ? Math.min(1, overlap(currentTokens, responseTokens) / Math.max(1, Math.min(6, currentTokens.size))) : 1
  const historyCoverage = matched / relevant.length
  const anaphoraBonus = anaphoraDetected && matched > 0 ? 0.15 : 0
  const score = Math.round(Math.max(0, Math.min(100, (directCoverage * 0.55 + historyCoverage * 0.45 + anaphoraBonus) * 100)))
  const reasons: string[] = []
  if (historyCoverage >= 0.5) reasons.push('The response overlaps with multiple relevant prior turns.')
  else reasons.push('The response overlaps with limited relevant prior context.')
  if (anaphoraDetected) reasons.push(matched > 0 ? 'Context-dependent wording was resolved against prior turns.' : 'Context-dependent wording was present but prior-turn grounding was weak.')
  if (directCoverage < 0.25) reasons.push('The response has weak lexical coverage of the current objective.')

  return { score, relevantTurnCount: relevant.length, matchedTurnCount: matched, anaphoraDetected, understood: score >= 60, reasons }
}

function sentenceClaims(content: string): string[] {
  return normalize(content)
    .split(/[.!?]+/) 
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 18)
    .slice(0, 120)
}

function polarity(claim: string): 'positive' | 'negative' | 'neutral' {
  if (/\b(?:not|never|cannot|can't|no|without|unavailable|failed|unknown|unverified|uncertain)\b/i.test(claim)) return 'negative'
  if (/\b(?:is|are|has|have|can|will|verified|confirmed|available|succeeded|proven)\b/i.test(claim)) return 'positive'
  return 'neutral'
}

function numericValues(claim: string): string[] {
  return [...claim.toLowerCase().matchAll(/\b\d+(?:\.\d+)?\s*(?:%|percent|ms|seconds?|minutes?|hours?|days?)\b/g)].map((m) => m[0])
}

/**
 * Claim-level consistency replaces brittle global word-pair contradiction
 * checks. Only compare claims with meaningful topic overlap; opposite polarity
 * or incompatible numeric values on the same topic are treated as conflicts.
 */
export function evaluateClaimConsistency(content: string): ClaimConsistencyResult {
  const claims = sentenceClaims(content)
  const contradictions: ClaimConsistencyResult['contradictions'] = []
  const claimTokens = claims.map((claim) => tokens(claim))

  for (let i = 0; i < claims.length; i += 1) {
    for (let j = i + 1; j < claims.length; j += 1) {
      const shared = overlap(claimTokens[i]!, claimTokens[j]!)
      if (shared < 3) continue
      const leftPolarity = polarity(claims[i]!)
      const rightPolarity = polarity(claims[j]!)
      if ((leftPolarity === 'positive' && rightPolarity === 'negative') || (leftPolarity === 'negative' && rightPolarity === 'positive')) {
        contradictions.push({ left: claims[i]!, right: claims[j]!, reason: 'Overlapping claims assert opposing states.' })
        continue
      }
      const leftNumbers = numericValues(claims[i]!)
      const rightNumbers = numericValues(claims[j]!)
      if (leftNumbers.length === 1 && rightNumbers.length === 1 && leftNumbers[0] !== rightNumbers[0]) {
        contradictions.push({ left: claims[i]!, right: claims[j]!, reason: 'Overlapping claims assert incompatible numeric values.' })
      }
    }
  }

  return { consistent: contradictions.length === 0, claims, contradictions: contradictions.slice(0, 12) }
}
