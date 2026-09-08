const RETROSPECTIVE_REQUEST_RE = /\b(?:why did (?:we|i)|what did we|what were we|what was the|how did we arrive at|where did we land on|remind me why|why was)\b[^?]{0,180}\b(?:choose|chose|decide|decided|select|selected|pick|picked|reason|reasoning|rationale|decision|plan|priority|name|called)\b/i
const EXPLICIT_RETROSPECTIVE_RE = /\b(?:what did we decide|what did we discuss|what did we choose|why did we choose|why did we decide|what was the reasoning|what led us to|how did we arrive at)\b/i
const DIRECT_CORRECTION_RE = /^\s*(?:that's\s+(?:not|n't)\b|that is\s+not\b|i\s+mean\b|what\s+i\s+meant\b|correction\b)/i
const NEGATED_CORRECTION_RE = /^\s*no\s*(?:,|-|:)\s*(?=(?:i|we|the|that|this|it|my|our|instead|rather)\b)/i
const CURRENT_TOPIC_REQUEST_RE = /\b(?:what are we discussing(?: now)?|what(?:'s| is)\s+(?:the\s+)?(?:current\s+)?(?:topic|subject)|what is this about)\b/i
const COMMITMENT_RE = /\b(?:i will|we will|let's|lets|we're going to|i'm going to)\b/i
// Leading discourse fillers ("mmm but", "well, so") stripped before matching CONTINUATION_OR_RESTATEMENT_RE
// below, so a real conversational prefix (verified against a live production transcript -- "mmm but tell
// me in your words.") doesn't defeat a start-anchored phrase match.
const LEADING_FILLER_RE = /^\s*(?:(?:mmm+|hmm+|uh+|um+|well|so|ok(?:ay)?|now|actually|but|and)[,.\s]+)+/i
// Canonical union of what used to be four independently-drifting regexes for the same underlying
// concept -- "the user wants prior conversational content continued, recapped, or restated" -- found
// scattered across ceo-response-quality-gate.ts (EXPLICIT_CONTINUATION_RE, plus a second, narrower inline
// exclusion inside its staleResponseLikelihood calculation) and ceo-degraded-mode.ts
// (isContinuityRecoveryRequest), already out of sync with each other (only the degraded-mode version knew
// "from where we left off" / "what have we ruled out" / "what about the second option"). None of the four
// recognized an explicit restatement request ("tell me in your words"), which is why a live production
// transcript saw a legitimate "tell me in your words" follow-up mislabeled continuity_failure by
// staleResponseLikelihood: a correct paraphrase of the assistant's own prior turn necessarily overlaps
// heavily with it, which is exactly what that heuristic (designed to catch a model lazily repeating itself
// instead of answering a new question) treats as suspicious. Consolidated to one definition, extended with
// the missing restatement phrasing, and reused everywhere the old four lived -- deliberately kept distinct
// from isRetrospectiveConversationRequest below, which is a different concept (recalling the REASONING
// behind a past decision, e.g. "why did we choose X") used only for pre-router intent classification.
const CONTINUATION_OR_RESTATEMENT_RE = /^(?:continue|go on|keep going|carry on|same thread|same topic|continue from there|where we left off|from where we left off|what did we decide|what did we discuss|what was the reasoning|what have we ruled out|what about the (?:first|second|third|last|other) option|based on what we established|remind me|recap|summarize|repeat (?:that|this|it)?\b|what did you say|tell me (?:that\s+)?in your (?:own\s+)?words|in your (?:own\s+)?words|put (?:it|that) (?:in your (?:own\s+)?words|your way)|say it your way|how would you (?:say|phrase) (?:it|that)|paraphrase (?:it|that))\b/i

/** Canonical speech-signal classification shared by routing, state derivation, and recovery. */
export function isRetrospectiveConversationRequest(text: string): boolean {
  const value = text.trim()
  return EXPLICIT_RETROSPECTIVE_RE.test(value) || RETROSPECTIVE_REQUEST_RE.test(value)
}

/**
 * Canonical continuation/restatement-request classification shared by the quality gate's reference-
 * continuation and stale-response checks and the degraded-mode recovery path. Strips leading discourse
 * fillers first so a natural prefix ("mmm but...") doesn't block the anchored phrase match.
 */
export function isContinuationOrRestatementRequest(text: string): boolean {
  const stripped = text.trim().replace(LEADING_FILLER_RE, '')
  return CONTINUATION_OR_RESTATEMENT_RE.test(stripped)
}

export function isCorrectionRequest(text: string): boolean {
  return DIRECT_CORRECTION_RE.test(text) || NEGATED_CORRECTION_RE.test(text)
}

export function isCurrentTopicRequest(text: string): boolean {
  return CURRENT_TOPIC_REQUEST_RE.test(text)
}

export function isCommitmentStatement(text: string): boolean {
  return COMMITMENT_RE.test(text)
}
