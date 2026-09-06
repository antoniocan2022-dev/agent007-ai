const RETROSPECTIVE_REQUEST_RE = /\b(?:why did (?:we|i)|what did we|what were we|what was the|how did we arrive at|where did we land on|remind me why|why was)\b[^?]{0,180}\b(?:choose|chose|decide|decided|select|selected|pick|picked|reason|reasoning|rationale|decision|plan|priority|name|called)\b/i
const EXPLICIT_RETROSPECTIVE_RE = /\b(?:what did we decide|what did we discuss|what did we choose|why did we choose|why did we decide|what was the reasoning|what led us to|how did we arrive at)\b/i
const DIRECT_CORRECTION_RE = /^\s*(?:that's\s+(?:not|n't)\b|that is\s+not\b|i\s+mean\b|what\s+i\s+meant\b|correction\b)/i
const NEGATED_CORRECTION_RE = /^\s*no\s*(?:,|-|:)\s*(?=(?:i|we|the|that|this|it|my|our|instead|rather)\b)/i
// Current-topic questions include the original explicit family plus common vague follow-ups that
// are semantically equivalent even when the user omits terminal punctuation. Keep this intentionally
// narrow so substantive one-token questions (for example "What is revenue?") are not reclassified.
const CURRENT_TOPIC_REQUEST_RE = /\b(?:what are we discussing(?: now)?|what(?:'s| is)\s+(?:the\s+)?(?:current\s+)?(?:topic|subject)|what is this about|where are we\s+(?:with\s+(?:this|that))?|where do we stand\s+(?:on\s+(?:this|that))?|what(?:'s| is)\s+going on(?: here)?|what now|how are we doing\s+(?:with\s+(?:this|that))?)\b/i

/** Canonical speech-signal classification shared by routing, state derivation, and recovery. */
export function isRetrospectiveConversationRequest(text: string): boolean {
  const value = text.trim()
  return EXPLICIT_RETROSPECTIVE_RE.test(value) || RETROSPECTIVE_REQUEST_RE.test(value)
}

export function isCorrectionRequest(text: string): boolean {
  return DIRECT_CORRECTION_RE.test(text) || NEGATED_CORRECTION_RE.test(text)
}

export function isCurrentTopicRequest(text: string): boolean {
  return CURRENT_TOPIC_REQUEST_RE.test(text)
}
