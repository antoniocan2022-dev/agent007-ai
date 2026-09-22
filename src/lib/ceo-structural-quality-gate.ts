/**
 * Recommendation 3 (2026-09-20), following the same external architecture review Recommendations 1 and
 * 2 implement: "move the quality gate from lexical-relaxation toward the structural contract the
 * analysis describes (claim coverage, contradiction preservation, source-vs-inference distinction) --
 * this needs Phase 3's structured source model as an input."
 *
 * Deliberately narrow, not a rewrite: ceo-response-quality-gate.ts's existing objectiveCoverage() is a
 * raw lexical token-overlap check that the long-document incident (2026-09-19) already found to be a
 * meaningless completion signal for a synthesis/summary task -- which is why it was relaxed to an
 * almost-no-op 8% threshold for long documents rather than fixed, since no STRUCTURED model of the
 * source existed yet to check against. Phase 3 (ceo-document-comprehension.ts) and its executor
 * (Recommendation 2, ceo-document-comprehension-executor.ts) now produce exactly that structured
 * model -- per-section extraction outputs plus a synthesis -- but only for the genuinely large
 * documents that clear shouldExecuteHierarchicalComprehension's necessity bar. This module is scoped to
 * exactly that population: assessStructuralQuality is a pure no-op (`applicable: false`) whenever no
 * source model is supplied, which is every turn this session's existing quality-gate tuning already
 * covers. It does not touch objectiveCoverage, evidenceOk, structureOk, or any of the other lexical
 * checks in ceo-response-quality-gate.ts for the vast majority of turns that never produce a structured
 * source model in the first place.
 */

// Deliberately self-contained rather than importing ceo-response-quality-gate.ts's own normalize/stem --
// that file is this module's own consumer, and importing back from it would create a cycle. A small
// local tokenizer costs nothing here; it only needs to answer "does this token appear," not replicate
// that file's full stemming/coverage-threshold logic.
const STOPWORDS = new Set(['about', 'after', 'again', 'also', 'because', 'before', 'being', 'between', 'could', 'from', 'have', 'into', 'more', 'most', 'other', 'should', 'that', 'their', 'there', 'these', 'they', 'this', 'those', 'through', 'under', 'what', 'when', 'where', 'which', 'while', 'with', 'would', 'your', 'please', 'then', 'than', 'just', 'like', 'really', 'very', 'doing', 'does', 'you', 'are', 'how', 'why', 'can', 'tell', 'give', 'make', 'want'])
function tokenSet(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/).map((token) => token.trim()).filter((token) => token.length >= 4 && !STOPWORDS.has(token)))
}

// A response mentioning the model's own hedged uncertainty, or explicit acknowledgment that sources
// disagree, is preserving a discrepancy rather than silently resolving it. Deliberately loose (any one
// of these phrasings counts) -- the point isn't to grade HOW WELL the contradiction is explained, only
// whether the response shows any trace of not having silently picked a side.
const CONTRADICTION_LANGUAGE_RE = /\b(?:contradict\w*|inconsisten\w*|conflict(?:s|ing)?|discrepan\w*|at odds|differs?\s+from\s+(?:each\s+other|one\s+another)|disagrees?\s+with|two\s+(?:different|conflicting)\s+(?:accounts?|views?|figures?|numbers?)|depending\s+on\s+(?:which|who|the\s+source))\b/i
// A sentence that explicitly negates the presence of a contradiction ("no discrepancies noted", "not
// inconsistent", "without conflict") must not itself count as flagging one -- found via this module's
// own test suite: "a straightforward synthesis with no discrepancies noted" tripped
// CONTRADICTION_LANGUAGE_RE on "discrepancies" alone. Deliberately requires the negation word to sit
// directly next to (within two words of) the contradiction term, rather than anywhere in the sentence --
// a whole-sentence negation scan (the approach ceo-response-quality-gate.ts's own NEGATION_RE uses for a
// similar problem) turned out too broad here: a sentence genuinely preserving a contradiction often also
// contains an unrelated negation ("this discrepancy could NOT be resolved from the material"), which a
// sentence-wide check would wrongly suppress.
const CONTRADICTION_NEGATION_RE = /\b(?:no|not|without|never)\s+(?:\w+\s+){0,2}(?:contradict\w*|inconsisten\w*|conflict\w*|discrepan\w*|disagreement\w*)\b/i
function sentenceSplit(value: string): string[] { return value.split(/\r?\n/).flatMap((line) => line.split(/[.!?;]+/)).map((sentence) => sentence.trim()).filter(Boolean) }
function contradictionFlagged(text: string): boolean { return sentenceSplit(text).some((sentence) => CONTRADICTION_LANGUAGE_RE.test(sentence) && !CONTRADICTION_NEGATION_RE.test(sentence)) }

/**
 * The quality gate's own view of Phase 3's structured source model -- a lightweight derived projection
 * of ceo-document-comprehension-executor.ts's HierarchicalComprehensionResult, not that type itself, so
 * this module's contract stays independent of the executor's internal fields (failureNotes,
 * sectionsFailed, durationMs, ...) that have nothing to do with assessing an already-produced answer.
 */
export interface StructuralSourceModel {
  sectionCount: number
  sectionExtracts: readonly { sectionIndex: number; text: string }[]
  synthesis: string
  coverageComplete?: boolean
}

export interface StructuralQualityAssessment {
  // False whenever no source model was supplied -- every check below defaults to a value that changes
  // nothing about the caller's existing pass/fail logic in that case.
  applicable: boolean
  claimCoverage: number
  claimCoverageOk: boolean
  representedSectionCount: number
  contradictionFlaggedUpstream: boolean
  contradictionPreserved: boolean
  // Source-vs-inference distinction: whether the answer shows ANY trace of attributing a claim to the
  // document versus its own synthesis/judgment (e.g. "the report states", "based on this, I'd
  // recommend"). Deliberately advisory, not gating -- unlike claim coverage and contradiction
  // preservation, a confident, well-grounded executive answer legitimately doesn't hedge every sentence
  // with a citation, so this is surfaced as a signal (see the returned `reasons`/logging call sites)
  // rather than a hard PASS/ESCALATE condition. It is a genuine part of the structural contract this
  // recommendation describes; a future round can decide, once real production signal exists, how much
  // weight it should carry.
  sourceAttributionPresent: boolean
  sourceCoverageComplete: boolean
}

// Deliberately loose: an accurate synthesis paraphrases a section, it does not quote it, so requiring
// heavy token density from any single section would penalize good writing. The structural signal this
// is meant to catch is coverage ACROSS sections (does the answer draw on the document broadly, the way
// objectiveCoverage's lexical check never could for a synthesis task) -- not density within any one.
const SECTION_OVERLAP_THRESHOLD = 0.08
// A genuine synthesis of a multi-section document should engage with a meaningful minority of its
// sections, not just the one or two most salient to a narrow sub-topic. Set below 0.5 deliberately: a
// good answer to a specific question about ONE aspect of a report legitimately weights toward the
// sections that actually bear on it.
const CLAIM_COVERAGE_MINIMUM = 0.25
// Matches the answer distinguishing what the source says from what the model itself concludes from it
// -- direct source attribution ("the report/document states/shows"), or the model's own inference
// framed as such ("based on this, I'd recommend", "my assessment is"). Either direction counts: the
// contract is that the two are distinguishable somewhere in the answer, not that the source is cited a
// particular number of times.
const SOURCE_VS_INFERENCE_RE = /\b(?:the\s+(?:document|report|source|material|text)\s+(?:states?|shows?|indicates?|says?|notes?|describes?)|according\s+to\s+(?:the\s+)?(?:document|report|source|text)|based\s+on\s+(?:the|this)\s+(?:document|report|analysis|data|material)|my\s+(?:assessment|inference|interpretation|read|take)\s+is|i\s+(?:infer|interpret|conclude|believe|assess)\b)/i

/**
 * Assesses an already-produced answer against Phase 3's structured source model: claim coverage (does
 * the answer draw on a meaningful spread of the document's own sections, not just lexical overlap with
 * the objective) and contradiction preservation (if the reduce/synthesis step noted an apparent
 * contradiction between sections, does the final answer show any trace of that rather than silently
 * resolving it one way). Returns `applicable: false` -- a pure no-op for every other check the result
 * feeds -- when no source model is supplied or it has no section extracts to check against.
 */
export function assessStructuralQuality(input: { sourceModel?: StructuralSourceModel; content: string }): StructuralQualityAssessment {
  if (!input.sourceModel || !input.sourceModel.sectionExtracts.length) {
    return { applicable: false, claimCoverage: 1, claimCoverageOk: true, representedSectionCount: 0, contradictionFlaggedUpstream: false, contradictionPreserved: true, sourceAttributionPresent: true, sourceCoverageComplete: true }
  }
  const answerTokens = tokenSet(input.content)
  const expectedSectionCount = Math.max(0, input.sourceModel.sectionCount)
  const sourceCoverageComplete = input.sourceModel.coverageComplete ?? (
    expectedSectionCount > 0 && input.sourceModel.sectionExtracts.length === expectedSectionCount
  )
  let represented = 0
  for (const section of input.sourceModel.sectionExtracts) {
    const sectionTokens = tokenSet(section.text)
    if (!sectionTokens.size) continue
    let shared = 0
    for (const token of sectionTokens) if (answerTokens.has(token)) shared += 1
    if (shared / sectionTokens.size >= SECTION_OVERLAP_THRESHOLD) represented += 1
  }
  const claimCoverage = expectedSectionCount > 0 ? represented / expectedSectionCount : 0
  const contradictionFlaggedUpstream = contradictionFlagged(input.sourceModel.synthesis)
  const contradictionPreserved = !contradictionFlaggedUpstream || contradictionFlagged(input.content)
  const sourceAttributionPresent = SOURCE_VS_INFERENCE_RE.test(input.content)
  return { applicable: true, claimCoverage, claimCoverageOk: sourceCoverageComplete && claimCoverage >= CLAIM_COVERAGE_MINIMUM, representedSectionCount: represented, contradictionFlaggedUpstream, contradictionPreserved, sourceAttributionPresent, sourceCoverageComplete }
}