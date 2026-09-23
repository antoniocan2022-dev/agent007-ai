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
// Routing-only objective continuation signals. These are deliberately separate from the broader
// continuation/restatement classifier used by response-quality and degraded-mode logic.
const OBJECTIVE_CONFIRMATION_WORD_RE = /^(?:yes|yeah|yep|yup|sure|okay|ok|go\s+ahead|proceed|do\s+it|continue|keep\s+going|carry\s+on|go\s+on)$/i
const AGREEMENT_PREFIX_RE = /^\s*(?:yes|yeah|yep|yup|sure|okay|ok|right|correct|exactly|that(?:'s|’s)\s+right|that(?:'s|’s)\s+correct|thats\s+right|thats\s+correct)\b/i
const EXPLICIT_CONTINUATION_CUE_RE = /\b(?:go\s+ahead|proceed|continue|keep\s+going|carry\s+on|go\s+on|move\s+forward|do\s+it|let(?:'|’)?s\s+do\s+it|from\s+there)\b/i
const TERMINAL_CONTINUATION_CUE_RE = /(?:go\s+ahead|proceed|continue|keep\s+going|carry\s+on|go\s+on|move\s+forward|do\s+it|let(?:'|’)?s\s+do\s+it|from\s+there)(?:\s+(?:with|on|from)\s+(?:this|that|it|these|those|the same|the thread|the topic|the plan|the request))?\s*[.!?]*$/i
const STRONG_ANAPHORIC_REFERENCE_RE = /\b(?:this|that|these|those|it|them|the\s+same|same|each|both)\b/i
const REFINEMENT_ACTION_RE = /\b(?:go\s+with|continue\s+with|build\s+on|give|tell|share|provide|show|send|pull|check|search|research|find|get|summar(?:i|y)ze|brief|explain|cover|compare|review|focus|include|walk\s+(?:me\s+)?through)\b/i

/** Bare confirmation/continuation used to attach a turn to an existing objective. */
export function isObjectiveConfirmationSignal(text: string): boolean {
  const cleaned = text.trim().replace(/[!.?]+$/, '')
  if (!cleaned) return false
  const clauses = cleaned.split(/\s*,\s*/)
  const lastClause = clauses[clauses.length - 1]?.trim()
  return Boolean(lastClause && OBJECTIVE_CONFIRMATION_WORD_RE.test(lastClause))
}

/** Detect an agreement-led refinement of an existing objective without widening quality-gate semantics. */
export function isObjectiveAgreementContinuationRequest(text: string): boolean {
  const stripped = text.trim().replace(LEADING_FILLER_RE, '')
  if (!stripped || !AGREEMENT_PREFIX_RE.test(stripped)) return false
  // A continuation cue is sufficient only when it is terminal or explicitly refers to the existing
  // objective. This prevents "Yes, go ahead. Tell me about the weather" from inheriting an unrelated thread.
  if (TERMINAL_CONTINUATION_CUE_RE.test(stripped)) return true
  return STRONG_ANAPHORIC_REFERENCE_RE.test(stripped) && REFINEMENT_ACTION_RE.test(stripped)
}

const BARE_OBJECTIVE_CONTINUATION_RE = /^(?:continue|go on|keep going|carry on|same thread|same topic|continue from there|where we left off|from where we left off|what did we decide|what did we discuss|what have we ruled out|what about the (?:first|second|third|last|other) option|based on what we established|what did you say|tell me (?:that\\s+)?in your (?:own\\s+)?words|in your (?:own\\s+)?words|put (?:it|that) (?:in your (?:own\\s+)?words|your way)|say it your way|how would you (?:say|phrase) (?:it|that)|paraphrase (?:it|that)|remind me)\\b/i
const REFERENTIAL_RESTATEMENT_RE = /^(?:summar(?:i|y)ze|recap)\\s+(?:this|that|it|these|those|our|the\\s+(?:discussion|conversation|thread|decision|plan|analysis|findings))\\b/i

/** Canonical routing continuity signal. Kept separate from the broader quality-gate restatement signal. */
export function isObjectiveContinuationSignal(text: string): boolean {
  const stripped = text.trim().replace(LEADING_FILLER_RE, '')
  return Boolean(
    stripped
    && (
      isObjectiveConfirmationSignal(stripped)
      || isObjectiveAgreementContinuationRequest(stripped)
      || BARE_OBJECTIVE_CONTINUATION_RE.test(stripped)
      || REFERENTIAL_RESTATEMENT_RE.test(stripped)
    ),
  )
}

/** Strong public-equity objective signal used only when a continuation needs intent inheritance. */
export function isLikelyPublicEquityResearchObjective(text: string): boolean {
  const value = text.trim()
  if (!value) return false
  const security = /\b(?:stock(?:s)?|share(?:s)?|equity|ticker(?:s)?|publicly\s+traded)\b/i.test(value)
  const research = /\b(?:research|check|look\s+(?:this|that|it)\s+up|find\s+(?:out|information)|news|headline|press\s+release|earnings|analyst|updates?|information|sec\s+filing|10-[kq])\b/i.test(value)
  return security && research
}
// Tier 4 hygiene fix (2026-09-13): another canonical-consolidation drift, of the same kind this file
// already fixed once for continuation/restatement detection. Three near-identical word lists for
// "this message contains a pronoun/anaphoric reference to prior context" had drifted apart: CONTEXT_RE
// (ceo-pre-router.ts) and CONTEXT_DEPENDENT_RE (adaptive-execution.ts) were identical to each other but
// both missing 'itself'/'themself'; containsAnaphora (ceo-context-intelligence.ts) had those two but was
// missing 'more'/'also'. Consolidated to the union of all three so none of the three call sites
// under-detects relative to the others.
// Exported (not just wrapped in a boolean helper) because ceo-pre-router.ts needs the match object
// itself (for its start index), not just a yes/no test.
export const CONTEXTUAL_REFERENCE_RE = /\b(?:this|that|these|those|it|they|them|above|previous|prior|continue|again|same|more|also|instead|as before|itself|themself)\b/i

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

/** Canonical anaphoric/context-dependent-reference detector; see CONTEXTUAL_REFERENCE_RE's comment. */
export function containsContextualReference(text: string): boolean {
  return CONTEXTUAL_REFERENCE_RE.test(text)
}
