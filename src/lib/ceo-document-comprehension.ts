/**
 * Long-document comprehension infrastructure (2026-09-20; authoritative document-operation mode).
 *
 * This module owns the source-document map/reduce plan used by the live executor in
 * ceo-document-comprehension-executor.ts. For explicit document operations, the resulting bounded
 * synthesis is the authoritative source model for final answer generation; the raw source is not
 * retransmitted to the final synthesis call. Ordinary short/medium conversational turns can still
 * remain on the normal single-pass path.
 *
 * The plan remains deliberately separate from execution: this file is pure document structure and
 * prompt construction, while the executor owns provider calls, bounded concurrency, time budgets,
 * cancellation, and partial-failure handling. Source Authority supplies the requestedOperation signal
 * so document operations have their own execution contract without widening the governed CeoIntent taxonomy.
 */

import type { RequestedOperation } from './ceo-cognitive-contract'

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

function operationGuidance(operation: RequestedOperation): string { switch (operation) { case 'document_summary': return 'Focus on key points, decisions, outcomes, metrics, and conclusions.'; case 'document_critique': return 'Focus on assumptions, weaknesses, unsupported claims, risks, contradictions, and reasoning gaps.'; case 'document_compare': return 'Focus on comparable claims, differences, similarities, trade-offs, and evidence.'; case 'document_extract': return 'Focus on explicit claims, facts, figures, names, dates, risks, findings, and other extractable items.'; default: return 'Focus on facts, arguments, dependencies, evidence, risks, contradictions, and conclusions for deep comprehension.' } }

function renderMapStepPrompt(section: DocumentSection, sectionCount: number, objective: string, requestedOperation: RequestedOperation = 'document_comprehension'): string {
  return `You are reading section ${section.index + 1} of ${sectionCount} of a longer document. Requested operation: ${requestedOperation}. ${operationGuidance(requestedOperation)} Do not summarize the whole document; you cannot see the other sections. Do not answer the final user request yet; extract only what this section contributes. If this section has nothing relevant, say so briefly.\n\nAuthoritative user instruction:\n${objective}\n\nSection ${section.index + 1} of ${sectionCount}:\n${section.text}`
}

// This prompt is the reduce step's INSTRUCTION only -- it deliberately does not embed the map steps'
// actual outputs, since this module never executes them (see the module-level comment). A future
// executor supplies those as separate message content (e.g. one message per collected map output)
// alongside this instruction; this function just needs to exist as its own step so the executor can
// build that message sequence without re-deriving the wording itself.
function renderReduceStepPrompt(objective: string, sectionCount: number, requestedOperation: RequestedOperation = 'document_comprehension'): string {
  return `You were given extraction notes from all ${sectionCount} sections of a longer document. Requested operation: ${requestedOperation}. ${operationGuidance(requestedOperation)} Synthesize the notes into one coherent, bounded source-grounded result for the user's instruction. Resolve apparent contradictions by noting them explicitly rather than silently picking one. Do not claim a fact came from the document unless it appeared in the extraction notes.\n\nAuthoritative user instruction:\n${objective}`
}

/**
 * Builds the comprehension plan for `document` against `objective`, without executing it. A
 * document that fits in one section gets strategy 'single_pass' (no map/reduce steps -- the
 * existing single-pass generation path is already correct for it). A document that doesn't gets
 * 'map_reduce': one map step per section (see renderMapStepPrompt) plus one reduce step (see
 * renderReduceStepPrompt) that a future execution step would run after collecting all the map
 * outputs. mapSteps/reduceStep are prompts only -- this function makes no model calls.
 */
export function buildHierarchicalComprehensionPlan(objective: string, document: string, sectionBudgetChars: number = DEFAULT_SECTION_BUDGET_CHARS, requestedOperation: RequestedOperation = 'document_comprehension'): DocumentComprehensionPlan {
  const trace = buildDocumentComprehensionTrace(document, sectionBudgetChars)
  if (!trace.requiresHierarchicalComprehension) return { strategy: 'single_pass', trace, mapSteps: [] }
  const mapSteps = trace.sections.map((section) => ({ sectionIndex: section.index, prompt: renderMapStepPrompt(section, trace.sectionCount, objective, requestedOperation) }))
  return { strategy: 'map_reduce', trace, mapSteps, reduceStep: { prompt: renderReduceStepPrompt(objective, trace.sectionCount, requestedOperation) } }
}
