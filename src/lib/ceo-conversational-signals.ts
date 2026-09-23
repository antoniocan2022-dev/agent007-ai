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
// Objective-continuation routing signal (2026-09-23): natural follow-ups often begin with agreement or
// confirmation and then refine the already-active task (for example, "Yes, exactly those. Go with a brief..."),
// without using a bare "continue" phrase. This is intentionally distinct from
// isContinuationOrRestatementRequest, which is also consumed by response-quality/staleness logic.
// Agreement-led continuation requires a strong cross-turn/anaphoric reference plus an action/refinement cue;
// standalone confirmation/continuation phrases use isObjectiveConfirmationSignal below.
// Demonstrative continuation signal: standalone "this/that/these/those" constructions that make a
// direct claim about an already-discussed object are common continuations even without an explicit
// "continue" verb. Deliberately excludes noun-determiner openings such as "This morning" or "That
// company" unless the construction is an explicit copular/modal continuation.
const DEMONSTRATIVE_CONTINUATION_RE = /^(?:this|that|these|those)\s+(?:(?:is|are|was|were|means?|should|could|would|can|will|has|have)\b|(?:principles?|ideas?|approaches?|plans?|issues?|problems?|points?|options?|priorities?|goals?|objectives?|changes?|results?|decisions?|reasons?|paths?|concepts?|strategies?|policies?|rules?|statements?|answers?|parts?|steps?|ones?|same|stocks?|shares?|companies?|documents?|files?|numbers?|figures?|data)\b)/i

export function isDemonstrativeContinuationRequest(text: string): boolean {
  const stripped = text.trim().replace(LEADING_FILLER_RE, '')
  return Boolean(stripped && DEMONSTRATIVE_CONTINUATION_RE.test(stripped))
}

// Sequenced-objective progression signal: phrases such as "the second priority is..." or "another
// objective..." are often a continuation of the active thread even when they have little literal token
// overlap with the opening turn. Kept separate from generic context/reference detection so an arbitrary
// new sentence is not automatically attached to an existing thread.
const OBJECTIVE_PROGRESSION_RE = /^(?:the\s+(?:second|third|next|other|last)\s+(?:priority|point|step|item|part|phase|option|issue|area|goal|objective)\b|another\s+(?:priority|point|step|item|part|phase|option|issue|area|goal|objective)\b)/i

export function isObjectiveProgressionRequest(text: string): boolean {
  const stripped = text.trim().replace(LEADING_FILLER_RE, '')
  return Boolean(stripped && OBJECTIVE_PROGRESSION_RE.test(stripped))
}

const AGREEMENT_PREFIX_RE = /^\s*(?:yes|yeah|yep|yup|sure|okay|ok|right|correct|exactly|that(?:'s|’s)\s+right|that(?:'s|’s)\s+correct|thats\s+right|thats\s+correct)\b/i
const STRONG_ANAPHORIC_REFERENCE_RE = /\b(?:these|those|it|them|the\s+same|same)\b|\b(?:this|that)(?=\s*(?:[.!?,;:]|$)|\s+(?:is|are|was|were|means?|should|could|would|can|will|has|have)\b)/i
const REFINEMENT_ACTION_RE = /\b(?:go\s+with|continue\s+with|build\s+on|give|tell|share|provide|show|send|pull|check|search|research|find|get|summar(?:i|y)ze|brief|explain|cover|compare|review|focus|include|walk\s+(?:me\s+)?through|proceed|move\s+forward|do\s+it|go\s+ahead)\b/i
const AGREEMENT_CORE_RE = /\b(?:exactly|right|correct|that(?:'s|’s)\s+(?:right|correct)|thats\s+(?:right|correct)|that\s+is\s+(?:right|correct|it))\b/i

/**
 * Recognize an agreement-led refinement only when the agreement/refinement relationship is explicit
 * in the nearby clause structure. This deliberately avoids treating an arbitrary pronoun in one clause
 * plus a new task in another as a continuation of the active objective.
 */
export function isObjectiveAgreementContinuationRequest(text: string): boolean {
  const stripped = text.trim().replace(LEADING_FILLER_RE, '')
  if (!stripped || !AGREEMENT_PREFIX_RE.test(stripped)) return false

  const clauses = stripped.split(/(?:[.!?]+|,\s+)/).map((clause) => clause.trim()).filter(Boolean)
  const hasSameClauseReferenceAndAction = clauses.some(
    (clause) => STRONG_ANAPHORIC_REFERENCE_RE.test(clause) && REFINEMENT_ACTION_RE.test(clause),
  )
  if (hasSameClauseReferenceAndAction) return true

  const confirmationReferenceLead = clauses.slice(0, 2).some(
    (clause) => AGREEMENT_CORE_RE.test(clause) && STRONG_ANAPHORIC_REFERENCE_RE.test(clause),
  )
  const laterRefinement = clauses.slice(1).some((clause) => REFINEMENT_ACTION_RE.test(clause))
  if (confirmationReferenceLead && laterRefinement) return true

  // No command-only exception is allowed here. "Go ahead" or "proceed" may introduce a new subject,
  // so an inherited objective requires an explicit nearby cross-turn reference as well.
  return false
}

// Canonical objective confirmation signal shared by pre-routing and conversation-thread derivation.
// It intentionally checks the final comma-separated clause, preserving the existing semantics for
// "yes, go ahead" and for compound corrections that end with "continue" without matching a generic
// mid-sentence use of "continue".
const OBJECTIVE_CONFIRMATION_WORD_RE = /^(?:yes|yeah|yep|yup|sure|okay|ok|go\s+ahead|proceed|do\s+it|continue|keep\s+going|carry\s+on|go\s+on)$/i
const AGREEMENT_ONLY_RE = new RegExp(AGREEMENT_PREFIX_RE.source)
export function isObjectiveConfirmationSignal(text: string): boolean {
  const cleaned = text.trim().replace(/[!.?]+$/, '')
  if (!cleaned) return false
  const clauses = cleaned.split(/\s*,\s*/)
  const lastClause = clauses[clauses.length - 1]?.trim()
  return Boolean(lastClause && OBJECTIVE_CONFIRMATION_WORD_RE.test(lastClause))
}
export function isBareObjectiveConfirmation(text: string): boolean {
  const cleaned = text.trim().replace(/[!.?]+$/, '')
  if (!cleaned) return false
  if (OBJECTIVE_CONFIRMATION_WORD_RE.test(cleaned)) return true
  const clauses = cleaned.split(/\s*,\s*/)
  return clauses.length === 2
    && AGREEMENT_ONLY_RE.test(clauses[0]!.trim())
    && OBJECTIVE_CONFIRMATION_WORD_RE.test(clauses[1]!.trim())
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

// Routing/state hardening (2026-09-23): the broad continuation classifier intentionally accepts prefix
// phrases such as "continue with ..." and "summarize ..." because response-quality and recovery logic
// need to recognize the user's conversational intent. Those phrases are NOT, by themselves, proof that
// the current task belongs to the active objective. Objective inheritance/thread mutation therefore uses
// this stricter contract: only a complete standalone continuation/restatement phrase can attach without
// another thread anchor. Non-bare variants must be anchored by the active thread in their caller.
const BARE_CONTINUATION_OR_RESTATEMENT_RE = /^(?:continue|go on|keep going|carry on|same thread|same topic|continue from there|where we left off|from where we left off|what did we decide|what did we discuss|what was the reasoning|what have we ruled out|what about the (?:first|second|third|last|other) option|based on what we established|remind me|recap|summarize|what did you say|tell me (?:that\\s+)?in your (?:own\\s+)?words|in your (?:own\\s+)?words|put (?:it|that) (?:in your (?:own\\s+)?words|your way)|say it your way|how would you (?:say|phrase) (?:it|that)|paraphrase (?:it|that))\\s*[.!?]*$/i

export function isBareContinuationOrRestatementRequest(text: string): boolean {
  const stripped = text.trim().replace(LEADING_FILLER_RE, '')
  return BARE_CONTINUATION_OR_RESTATEMENT_RE.test(stripped)
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
