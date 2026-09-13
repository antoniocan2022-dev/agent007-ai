/** Canonical CEO self-reflection classification.
 *
 * This module is the single source of truth for requests whose subject is
 * Agent007/CEO itself. It is deterministic and intentionally free of LLM
 * calls so it cannot add latency or introduce a new provider dependency.
 *
 * The classifier identifies reflection only when the request is not an
 * explicit operational/research/mission action. Downstream layers consume
 * this decision instead of re-parsing the raw user text.
 */

export type SelfReflectionKind =
  | 'none'
  | 'casual_checkin'
  | 'performance_reflection'
  | 'capability_assessment'
  | 'readiness_assessment'

export interface SelfReflectionClassification {
  kind: SelfReflectionKind
  isSelfReflective: boolean
  reason: string
}

export type ExecutiveReadinessLevel = 'A' | 'B' | 'C' | 'D' | 'E'

export interface ExecutiveReadinessSynthesis {
  level: ExecutiveReadinessLevel
  label: string
  capability: string
  verified: string
  notProven: string
  nextEvidence: string
  observedAt?: number
}

const SELF_REFERENCE_RE = /\b(?:you|your|yourself|agent007|ceo|the\s+(?:agent|system|assistant))\b/i
// A request for "a self-assessment" (or self-evaluation/-review/-audit/-reflection) is unambiguously
// about the entity being asked, with no second-person pronoun required -- unlike SELF_REFERENCE_RE,
// which only recognizes self-reference via an explicit "you/your/CEO/agent007/the system" word. A live
// production incident (2026-09-12) showed a request phrased entirely in third person ("give me a full
// self-assessment across partners, leadership, strategy, and decisions") failing SELF_REFERENCE_RE,
// falling through to a bare "strategy" keyword match, and getting misclassified as generic analysis --
// so the self-assessment data pipeline never ran and the model had nothing real to answer from. This
// is a second, independent path into self-reflection recognition (checked below), not a patch that
// special-cases that one sentence.
const EXPLICIT_SELF_ASSESSMENT_RE = /\bself[- ](?:assessment|evaluation|review|audit|reflection)\b/i
// Exported so other intent classifiers (e.g. ceo-cognitive-conversation.ts's userIntentHint) can
// recognize this same explicit phrasing without re-implementing their own copy of the pattern, which
// is what let two independent self-assessment regexes drift out of sync in the first place. Those
// callers intentionally do NOT get the fuller isSelfReflective check below (READINESS_RE/CAPABILITY_RE/
// PERFORMANCE_RE) -- that broader net is calibrated for this module's own routing decision and is too
// permissive for contexts (like completeness/fragment detection) that need a precise, explicit signal.
export function hasExplicitSelfAssessmentPhrase(text: string): boolean { return EXPLICIT_SELF_ASSESSMENT_RE.test(text) }
const OPERATIONAL_COMMAND_RE = /^(?:please\s+)?(?:deploy|publish|send|buy|sell|invest|transfer|execute|implement|fix|create|delete|edit|update|change|launch|ship|start|stop|enable|disable|schedule|commit)\b/i
const TARGETED_OPERATION_RE = /\b(?:deploy|publish|send|buy|sell|invest|transfer|execute|implement|fix|create|delete|edit|update|change|launch|ship|start|stop|enable|disable|schedule|commit)\s+(?:this|the|my|our|approved|production|release|build|customer|invoice|mission|venture|business|company|campaign)\b/i
const RESEARCH_RE = /\b(?:research|search|look\s+up|find\s+(?:out|information)|verify|validate)\b/i
const MISSION_ACTION_RE = /\b(?:start|run|manage|execute|launch)\s+(?:this|the|my|our)\s+(?:mission|venture|business|company)\b|\b(?:start|execute|launch)\s+(?:a|an)\s+(?:mission|venture)\b/i
const ANALYSIS_TARGET_RE = /\b(?:analy[sz]e|assess|evaluate|review|diagnose|compare|design|plan)\b.*\b(?:this|that|these|those|the\s+(?:architecture|system|data|market|report|document|problem|request)|customer|churn|competitor|financial|legal)\b/i
/** Tolerates a leading salutation ("Hi Agent007,") so a greeting doesn't defeat the anchored check-in match below. */
const GREETING_PREFIX_RE = `(?:(?:hi|hey|hello|hiya|howdy|greetings)[,!.\\s]*(?:agent\\s?007|ceo)?[,!.\\s]*)?`
const CASUAL_CHECKIN_RE = new RegExp(`^${GREETING_PREFIX_RE}(?:how(?:'s|\\s+is)\\s+(?:it|everything|things?)\\s+going|how\\s+are\\s+(?:you|things?)(?:\\s+doing)?(?:\\s+today|\\s+now|\\s+lately|\\s+these\\s+days)?|how\\s+do\\s+you\\s+do|how\\s+is\\s+(?:agent007|the\\s+(?:system|ceo|agent))\\s+doing|you\\s+(?:good|okay|alright)|what(?:'s|\\s+is)\\s+new(?:\\s+with\\s+you)?)[!.?\\s]*$`, 'i')
// Deep-audit fix (2026-09-13): every one of these bare words used to match anywhere in the message
// independent of where the "you/your" satisfying SELF_REFERENCE_RE actually was, so a business
// question with the self-reference pronoun in an unrelated clause ("You mentioned our revenue growth
// this quarter, how's it looking?") got misclassified as performance_reflection. `nearSelfReference`
// (below) requires the word to actually sit close to a self-reference term, in either order, mirroring
// the same proximity discipline ceo-self-inspection.ts's SELF_HISTORY_SIGNAL_RE already uses for the
// identical class of bug. The two already-anchored full phrases at the end already embed "you"
// literally and need no wrapping.
// Word-count gap rather than a character-count gap: length-invariant across short vs. long trigger
// words/phrases, and empirically the only version that actually separates the two cases -- a
// character budget generous enough for "your revenue growth" (adjacent) was, by construction, also
// generous enough for "our engineers are capable" (four words, ~25 characters) to slip through.
// maxWords=2 tolerates the short connective phrasing every genuine self-directed question in this
// file's own test suite actually uses ("are you ready TO MANAGE a business") while excluding the
// longer, unrelated-subject clauses the audit's adversarial probes used ("do you think OUR ENGINEERS
// ARE capable" -- four intervening words).
const SELF_REFERENCE_WORD_RE_SOURCE = '(?:you|your|yourself|agent007|ceo|the\\s+(?:agent|system|assistant))'
function nearSelfReference(word: string, maxWords = 2): string {
  const gap = `(?:\\S+\\s+){0,${maxWords}}`
  return `(?:\\b${SELF_REFERENCE_WORD_RE_SOURCE}\\b\\s+${gap}\\b${word}\\b|\\b${word}\\b\\s+${gap}\\b${SELF_REFERENCE_WORD_RE_SOURCE}\\b)`
}
const PERFORMANCE_RE = new RegExp(
  [nearSelfReference('improving'), nearSelfReference('getting\\s+better'), nearSelfReference('performance'), nearSelfReference('performing'), nearSelfReference('progress'), nearSelfReference('progressing'), nearSelfReference('better'), nearSelfReference('worse'), nearSelfReference('declining'), nearSelfReference('evolving'), nearSelfReference('evolution'), nearSelfReference('learning'), nearSelfReference('developing'), nearSelfReference('growth'), '\\bhow\\s+have\\s+you\\s+been\\b', '\\bhow\\s+are\\s+you\\s+performing\\b'].join('|'),
  'i',
)
// 'upgrades?'/'new features?'/'recently added' added (2026-09-12): a direct "what upgrades have you
// gotten recently?" or "tell me about your recent upgrades" previously matched no kind at all (fell
// through every branch to 'none') despite clearly asking the same question this whole classifier
// exists to answer -- none of strengths/weakness/capability/skills/architecture/verified covers the
// word "upgrade". Deliberately does not add a bare "what's new" here: that exact phrasing is already
// claimed, anchored to the whole message, by CASUAL_CHECKIN_RE above as small talk, and duplicating
// it here would just race that precedence.
//
// Post-merge audit fix (2026-09-12): the first version of this also added a standalone
// `recent\s+(?:upgrades?|additions?|updates?|changes?)` alternative. It was redundant for its own
// stated purpose -- both motivating cases ("What upgrades have you gotten recently?", "Tell me about
// your recent upgrades.") already match the bare `upgrades?` alternative above -- and its
// `updates?`/`changes?` branches are two of the most overloaded words in ordinary business speech:
// any self-referential turn ("do you have any recent updates on the deal?", "what recent changes did
// you make to the campaign?") matched it and got misrouted onto the bounded, tool-free self_assessment
// fast lane instead of the real analysis/operational path that could actually answer the question.
// Removed entirely rather than narrowed, since nothing in this file's own tests needed it.
// Deep-audit fix (2026-09-13): same proximity fix as PERFORMANCE_RE above -- "Do you think our
// engineers are capable of handling this workload?" used to misclassify as capability_assessment
// purely because "you" and "capable" both appeared somewhere in the message, regardless of how far
// apart. `what can you do`/`what are you good at` already embed "you" literally and stay bare.
const CAPABILITY_RE = new RegExp(
  [nearSelfReference('strengths?'), nearSelfReference('weakness(?:es)?'), nearSelfReference('capabilit(?:y|ies)'), nearSelfReference('capable'), nearSelfReference('skills?'), nearSelfReference('limitations?'), '\\bwhat\\s+can\\s+you\\s+do\\b', '\\bwhat\\s+are\\s+you\\s+good\\s+at\\b', nearSelfReference('architecture'), nearSelfReference('proven'), nearSelfReference('unproven'), nearSelfReference('(?:not\\s+yet\\s+|un)?verified'), nearSelfReference('upgrades?'), nearSelfReference('new\\s+features?'), nearSelfReference('recently\\s+added')].join('|'),
  'i',
)
// Deep-audit fix (2026-09-13): same proximity fix -- "Do you think Sarah is ready to manage a business
// unit?" used to misclassify as readiness_assessment purely because "you" appeared elsewhere in the
// message ("ready" itself was bare and matched regardless). All alternatives are now proximity-gated,
// including ready/readiness/prepared/equipped/fit to/able to manage/autonom(y|ous) -- none of them are
// meaningfully safer than the business/company phrases in ordinary business speech ("is the report
// ready? are you free to review it?"). This stays consistent with the MISSION_ACTION_RE-precedence
// comment below, which only needs the business/company phrases to match near an explicit self-reference
// like "Agent007" in the same short question -- already satisfied by the proximity gate.
const READINESS_RE = new RegExp(
  [nearSelfReference('ready'), nearSelfReference('readiness'), nearSelfReference('prepared'), nearSelfReference('equipped'), nearSelfReference('fit\\s+to'), nearSelfReference('able\\s+to\\s+manage'), nearSelfReference('manage\\s+(?:a\\s+)?business(?:es)?'), nearSelfReference('run\\s+(?:a\\s+)?business(?:es)?'), nearSelfReference('run\\s+(?:a\\s+)?compan(?:y|ies)'), nearSelfReference('business\\s+management'), nearSelfReference('autonom(?:y|ous)')].join('|'),
  'i',
)
const IMPROVEMENT_REQUEST_RE = /\b(?:i\s+want\s+to\s+(?:improve|build|change|update|work\s+on|develop)|let'?s\s+(?:improve|focus\s+on|work\s+on|build|develop)|help\s+(?:me\s+)?(?:improve|build)|can\s+(?:we|you)\s+(?:improve|work\s+on|focus\s+on))\b/i

export function classifyCeoSelfReflection(text: string): SelfReflectionClassification {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return { kind: 'none', isSelfReflective: false, reason: 'No substantive request.' }
  if (CASUAL_CHECKIN_RE.test(normalized)) return { kind: 'casual_checkin', isSelfReflective: false, reason: 'Short conversational check-in; keep it on the normal conversation path.' }
  const explicitSelfAssessmentRequest = EXPLICIT_SELF_ASSESSMENT_RE.test(normalized)
  if (!explicitSelfAssessmentRequest && !SELF_REFERENCE_RE.test(normalized)) return { kind: 'none', isSelfReflective: false, reason: 'No CEO self-reference detected.' }

  // MISSION_ACTION_RE matches "run the company"/"manage a business" wherever it appears in the
  // sentence, including inside a readiness QUESTION about the CEO's own capability ("is Agent007
  // ready to run the company by itself?") rather than an imperative command to actually do it now.
  // READINESS_RE already recognizes that same phrase as a genuine self-readiness question (its own
  // "run/manage a business/company" alternatives), so when both match, this is a capability question,
  // not an operational command -- MISSION_ACTION_RE's precedence should not apply here.
  const readinessSignal = READINESS_RE.test(normalized)
  if (OPERATIONAL_COMMAND_RE.test(normalized) || TARGETED_OPERATION_RE.test(normalized) || RESEARCH_RE.test(normalized) || (!readinessSignal && MISSION_ACTION_RE.test(normalized)) || ANALYSIS_TARGET_RE.test(normalized) || IMPROVEMENT_REQUEST_RE.test(normalized)) {
    return { kind: 'none', isSelfReflective: false, reason: 'Explicit operational, research, mission, external-analysis, or improvement-planning language takes precedence.' }
  }

  if (CASUAL_CHECKIN_RE.test(normalized)) return { kind: 'casual_checkin', isSelfReflective: false, reason: 'Short conversational check-in; keep it on the normal conversation path.' }
  if (explicitSelfAssessmentRequest) return { kind: 'readiness_assessment', isSelfReflective: true, reason: 'Explicit self-assessment/self-evaluation/self-review/self-audit/self-reflection request; recognized regardless of pronoun.' }
  if (READINESS_RE.test(normalized)) return { kind: 'readiness_assessment', isSelfReflective: true, reason: 'Self-readiness or business-management capability assessment.' }
  if (CAPABILITY_RE.test(normalized)) return { kind: 'capability_assessment', isSelfReflective: true, reason: 'Self-capability assessment.' }
  if (PERFORMANCE_RE.test(normalized) || /\b(?:how|where)\s+are\s+you\b/i.test(normalized)) return { kind: 'performance_reflection', isSelfReflective: true, reason: 'Self-performance or progress reflection.' }

  return { kind: 'none', isSelfReflective: false, reason: 'Self-reference detected but no safe reflective intent established.' }
}

/**
 * Deterministic executive-readiness synthesis over already-governed evidence.
 * Levels are cumulative and conservative: architecture supports A, explicit
 * governed operational capability supports B, current live execution plus
 * production-traffic proof supports C, repeatable outcomes supports D, and
 * sustained autonomy supports E. Stale evidence cannot advance readiness.
 */
export function synthesizeExecutiveReadiness(input: {
  operationalCapabilityVerified: boolean
  liveExecutionVerified: boolean
  productionTrafficVerified: boolean
  repeatableBusinessOutcomesVerified: boolean
  sustainedAutonomyVerified: boolean
  observedAt?: number
  maxEvidenceAgeMs?: number
  now?: number
}): ExecutiveReadinessSynthesis {
  const now = input.now ?? Date.now()
  const evidenceFresh = input.observedAt !== undefined && input.maxEvidenceAgeMs !== undefined
    ? now - input.observedAt >= 0 && now - input.observedAt <= input.maxEvidenceAgeMs
    : false
  const liveVerified = input.liveExecutionVerified && input.productionTrafficVerified && evidenceFresh

  if (liveVerified && input.sustainedAutonomyVerified && input.repeatableBusinessOutcomesVerified) {
    return {
      level: 'E',
      label: 'Sustained autonomy',
      capability: 'The system has evidence supporting autonomous business operation over a sustained period.',
      verified: 'Sustained autonomous operation is explicitly evidenced by governed outcome data.',
      notProven: 'No higher readiness category remains in this model.',
      nextEvidence: 'Continue monitoring sustained outcomes and governance exceptions.',
      observedAt: input.observedAt,
    }
  }

  if (liveVerified && input.repeatableBusinessOutcomesVerified) {
    return {
      level: 'D',
      label: 'Repeatable outcomes',
      capability: 'The system has evidence of repeatable business outcomes from live execution.',
      verified: 'Repeatable outcomes are explicitly evidenced by governed result data.',
      notProven: 'Sustained autonomous operation is not yet proven.',
      nextEvidence: 'Accumulate sustained autonomous-operation evidence.',
      observedAt: input.observedAt,
    }
  }

  if (liveVerified) {
    return {
      level: 'C',
      label: 'Live governed execution',
      capability: 'The system has evidence of successful governed execution in production.',
      verified: 'Live execution and production traffic are explicitly evidenced within the freshness window.',
      notProven: 'Repeatable business outcomes and sustained autonomy are not yet proven.',
      nextEvidence: 'Accumulate repeatable governed business outcomes.',
      observedAt: input.observedAt,
    }
  }

  if (input.operationalCapabilityVerified) {
    return {
      level: 'B',
      label: 'Governed operational capability',
      capability: 'The system has governed operational capabilities that are structurally verified.',
      verified: 'Operational capability is supported by repository and workflow verification.',
      notProven: 'Live production execution, repeatable outcomes, and sustained autonomy are not yet proven.',
      nextEvidence: 'Verify successful live execution against current production traffic.',
      observedAt: input.observedAt,
    }
  }

  return {
    level: 'A',
    label: 'Architectural foundation',
    capability: 'The system has an established executive architecture and governance foundation.',
    verified: 'Architectural capability is supported by code and CI contracts.',
    notProven: 'Operational capability, live execution, repeatable outcomes, and sustained autonomy are not yet proven.',
    nextEvidence: 'Establish explicit governed operational execution evidence.',
    observedAt: input.observedAt,
  }
}
