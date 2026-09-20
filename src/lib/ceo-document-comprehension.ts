/**
 * Phase 3 of the long-document comprehension work (2026-09-20): hierarchical comprehension
 * infrastructure for a source document too large to reason about in a single pass.
 *
 * Phase 1 (the production-incident fix, #182) and Phase 2 (the canonical CeoComprehensionMode
 * signal) both operate on the whole document in one shot -- they fixed the CLASSIFICATION of a
 * long-document turn and the QUALITY-GATE judgment of its answer, but the actual generation step
 * still hands the model the entire clamped document (up to CEO_MESSAGE_CLAMP_CHARS) in one prompt.
 * That is a sound, working design for anything that fits inside a governed provider's real context
 * window (see provider-control-plane.ts's DEFAULT_MAX_INPUT_TOKENS comment) -- which is the large
 * majority of real pasted documents. It stops being sound only once a document is long enough that
 * a single pass can no longer attend to all of it well, which single-pass generation has no way to
 * detect or compensate for on its own.
 *
 * This module builds the map-reduce SCAFFOLD for that harder case: splitting a document into
 * paragraph-respecting sections sized for a focused per-section pass, and rendering the map-step
 * (per-section extraction) and reduce-step (cross-section synthesis) prompts a future execution
 * step would send through the model. It deliberately stops at the plan -- it does not call
 * runCanonicalLlm itself, and nothing in ceo-cognitive-lifecycle.ts or route.ts imports it yet.
 * Wiring actual per-section execution into the live generation path is a separate, larger change
 * (it touches latency budgets, provider selection, evidence composition and partial-failure
 * handling for N sub-calls instead of one) that deserves its own review rather than being folded
 * silently into this phase. Keeping the plan/execution boundary explicit here mirrors the existing
 * ceo-evidence-planner.ts / ceo-evidence-executor.ts split elsewhere in this codebase.
 */

export interface DocumentSection {
  index: number
  start: number
  end: number
  text: string
  charLength: number
}

export interface DocumentComprehensionTrace {
  totalChars: number
  sectionCount: number
  sections: readonly DocumentSection[]
  sectionBudgetChars: number
  requiresHierarchicalComprehension: boolean
}

export interface ComprehensionMapStep {
  sectionIndex: number
  prompt: string
}

export interface ComprehensionReduceStep {
  prompt: string
}

export interface DocumentComprehensionPlan {
  strategy: 'single_pass' | 'map_reduce'
  trace: DocumentComprehensionTrace
  mapSteps: readonly ComprehensionMapStep[]
  reduceStep?: ComprehensionReduceStep
}

// Sized well under any governed provider's real context window (see provider-control-plane.ts's
// DEFAULT_MAX_INPUT_TOKENS comment -- the smallest is ~128K tokens) with generous room left in the
// same request for the map-step instruction, the objective, and the model's own response -- a
// single section is meant to be comfortably, not maximally, within one focused pass.
export const DEFAULT_SECTION_BUDGET_CHARS = 6_000

// Deep-audit fix (2026-09-20): returns each part's offsets RELATIVE TO THE PARAGRAPH, not just its
// text. A part that ends at a space boundary skips that one character when advancing to the next part
// (so no part starts or ends with a stray space) -- chunkDocumentIntoSections needs those exact
// relative offsets to compute each section's true position in the original document; naively summing
// part.length across parts silently drifts out of sync by one character per skipped space.
function splitOversizedParagraph(paragraph: string, maxChars: number): { text: string; start: number; end: number }[] {
  const parts: { text: string; start: number; end: number }[] = []
  let cursor = 0
  while (cursor < paragraph.length) {
    const end = Math.min(paragraph.length, cursor + maxChars)
    let boundary = end
    if (end < paragraph.length) {
      const lastSpace = paragraph.lastIndexOf(' ', end)
      if (lastSpace > cursor + maxChars * 0.5) boundary = lastSpace
    }
    parts.push({ text: paragraph.slice(cursor, boundary), start: cursor, end: boundary })
    cursor = boundary === cursor ? end : (paragraph[boundary] === ' ' ? boundary + 1 : boundary)
  }
  return parts
}

/**
 * Splits `text` into sections of at most `maxSectionChars`, never breaking a paragraph across two
 * sections unless the paragraph itself exceeds the budget (in which case that one paragraph is
 * hard-split, still preferring a space boundary near the cut). Paragraphs are grouped greedily, so
 * a section is always as full as it can be without crossing the budget -- not one paragraph each.
 * start/end are offsets into the ORIGINAL text (not the trimmed paragraph), so a caller can always
 * trace a section back to exactly where it came from.
 */
export function chunkDocumentIntoSections(text: string, maxSectionChars: number = DEFAULT_SECTION_BUDGET_CHARS): DocumentSection[] {
  const sections: DocumentSection[] = []
  if (!text) return sections
  const paragraphs: { text: string; start: number }[] = []
  let cursor = 0
  for (const raw of text.split(/\n{2,}/)) {
    const start = text.indexOf(raw, cursor)
    const resolvedStart = start >= 0 ? start : cursor
    if (raw.trim().length) paragraphs.push({ text: raw, start: resolvedStart })
    cursor = resolvedStart + raw.length
  }
  let current: { pieces: { text: string; start: number }[]; length: number } = { pieces: [], length: 0 }
  const flush = () => {
    if (!current.pieces.length) return
    const first = current.pieces[0]
    const last = current.pieces[current.pieces.length - 1]
    const sectionText = current.pieces.map((piece) => piece.text).join('\n\n')
    sections.push({ index: sections.length, start: first.start, end: last.start + last.text.length, text: sectionText, charLength: sectionText.length })
    current = { pieces: [], length: 0 }
  }
  for (const paragraph of paragraphs) {
    if (paragraph.text.length > maxSectionChars) {
      flush()
      for (const part of splitOversizedParagraph(paragraph.text, maxSectionChars)) {
        sections.push({ index: sections.length, start: paragraph.start + part.start, end: paragraph.start + part.end, text: part.text, charLength: part.text.length })
      }
      continue
    }
    const additionalLength = paragraph.text.length + (current.pieces.length ? 2 : 0)
    if (current.length + additionalLength > maxSectionChars && current.pieces.length) flush()
    const lengthToAdd = paragraph.text.length + (current.pieces.length ? 2 : 0)
    current.pieces.push(paragraph)
    current.length += lengthToAdd
  }
  flush()
  return sections
}

export function buildDocumentComprehensionTrace(text: string, sectionBudgetChars: number = DEFAULT_SECTION_BUDGET_CHARS): DocumentComprehensionTrace {
  const sections = chunkDocumentIntoSections(text, sectionBudgetChars)
  return {
    totalChars: text.length,
    sectionCount: sections.length,
    sections,
    sectionBudgetChars,
    requiresHierarchicalComprehension: sections.length > 1,
  }
}

function renderMapStepPrompt(section: DocumentSection, sectionCount: number, objective: string): string {
  return `You are reading section ${section.index + 1} of ${sectionCount} of a longer document. Extract only the facts, figures, and claims in THIS section that are relevant to the reader's request below. Do not summarize the whole document -- you cannot see the other sections. Do not answer the request yet; just extract what this section contributes to it. If this section has nothing relevant, say so briefly.\n\nReader's request:\n${objective}\n\nSection ${section.index + 1} of ${sectionCount}:\n${section.text}`
}

// This prompt is the reduce step's INSTRUCTION only -- it deliberately does not embed the map steps'
// actual outputs, since this module never executes them (see the module-level comment). A future
// executor supplies those as separate message content (e.g. one message per collected map output)
// alongside this instruction; this function just needs to exist as its own step so the executor can
// build that message sequence without re-deriving the wording itself.
function renderReduceStepPrompt(objective: string, sectionCount: number): string {
  return `You were given extraction notes from all ${sectionCount} sections of a longer document (each produced independently, without seeing the other sections). Synthesize them into one coherent answer to the reader's original request. Resolve any apparent contradictions between sections by noting them explicitly rather than silently picking one. Do not claim a fact came from the document unless it actually appeared in the extraction notes.\n\nReader's request:\n${objective}`
}

/**
 * Builds the comprehension plan for `document` against `objective`, without executing it. A
 * document that fits in one section gets strategy 'single_pass' (no map/reduce steps -- the
 * existing single-pass generation path is already correct for it). A document that doesn't gets
 * 'map_reduce': one map step per section (see renderMapStepPrompt) plus one reduce step (see
 * renderReduceStepPrompt) that a future execution step would run after collecting all the map
 * outputs. mapSteps/reduceStep are prompts only -- this function makes no model calls.
 */
export function buildHierarchicalComprehensionPlan(objective: string, document: string, sectionBudgetChars: number = DEFAULT_SECTION_BUDGET_CHARS): DocumentComprehensionPlan {
  const trace = buildDocumentComprehensionTrace(document, sectionBudgetChars)
  if (!trace.requiresHierarchicalComprehension) return { strategy: 'single_pass', trace, mapSteps: [] }
  const mapSteps = trace.sections.map((section) => ({ sectionIndex: section.index, prompt: renderMapStepPrompt(section, trace.sectionCount, objective) }))
  return { strategy: 'map_reduce', trace, mapSteps, reduceStep: { prompt: renderReduceStepPrompt(objective, trace.sectionCount) } }
}
