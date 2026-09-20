/**
 * Recommendation 2 (2026-09-20), following an external architecture review: wires
 * ceo-document-comprehension.ts's map-reduce PLAN to actual execution, completing the
 * plan/executor split ceo-document-comprehension.ts's own module comment described as deferred
 * (mirroring the existing ceo-evidence-planner.ts / ceo-evidence-executor.ts split elsewhere in
 * this codebase).
 *
 * Deliberately conservative: this is an ADDITIVE augmentation, not a replacement for single-pass
 * generation. Single-pass generation (Phase 1's fix) is already correct and unchanged for the
 * large majority of real documents -- everything up to CEO_MESSAGE_CLAMP_CHARS fits comfortably
 * under the provider-control-plane's real preflight budget (see DEFAULT_MAX_INPUT_TOKENS's own
 * comment). This executor exists for the genuinely large remainder, where a single pass CAN
 * technically still fit but a focused per-section pass produces measurably better comprehension --
 * and even then, its only job is to produce an extra grounding synthesis alongside the untouched
 * original document, never to replace or gate the existing quality-gated generation path. Every
 * failure mode here (a section's map call failing, the whole pass running out of time, the reduce
 * call itself failing) degrades to "no synthesis produced," which the caller treats identically to
 * "hierarchical comprehension wasn't needed" -- this can only ever help, never block or degrade a
 * turn relative to today's behavior.
 */

import { runCanonicalLlm } from './canonical-llm-router'
import { isCeoRequestAborted } from './ceo-cancellation'
import type { DocumentComprehensionPlan, DocumentComprehensionTrace } from './ceo-document-comprehension'
import type { RequestedOperation } from './ceo-cognitive-contract'

// Deep-audit fix (2026-09-20): deliberately does NOT use canonical-llm-router.ts's own
// runCanonicalLlmParallel. That helper gates every request through classifyExecution/explicitPlan's
// `parallelizable` flag -- a heuristic tuned for real user-typed conversational messages (it treats
// "this"/"that"/other contextual-reference language as a signal the request might carry hidden,
// order-dependent context and should therefore run one at a time). Every map-step prompt this module
// generates legitimately says "this section" (see renderMapStepPrompt in ceo-document-comprehension.ts),
// which trips that exact heuristic and made runCanonicalLlmParallel reject every single map call with
// "Adaptive execution rejected parallel fan-out" -- confirmed directly, not assumed. These are
// synthetic, independently-generated extraction prompts with no such dependency between them; this
// module owns its own bounded-concurrency policy instead of being subject to a classifier built for an
// unrelated use case.
async function runBounded<T>(items: readonly T[], concurrency: number, run: (item: T, index: number) => Promise<{ index: number; content?: string }>): Promise<{ index: number; content?: string }[]> {
  const results: { index: number; content?: string }[] = []
  for (let start = 0; start < items.length; start += concurrency) {
    const batch = items.slice(start, start + concurrency)
    // A genuine request cancellation must propagate, not be absorbed as "this one section failed" --
    // the per-section catch below is only for real provider/network failures, isolated the same way
    // runCanonicalLlmParallel already isolates them.
    const batchResults = await Promise.all(batch.map((item, offset) => run(item, start + offset).catch((error) => { if (isCeoRequestAborted(error)) throw error; return { index: start + offset, content: undefined } })))
    results.push(...batchResults)
  }
  return results
}

// Execution is gated on a stricter bar than the plan's own requiresHierarchicalComprehension
// (which fires at >1 section, i.e. any document past DEFAULT_SECTION_BUDGET_CHARS = 6,000 chars).
// Spending N extra LLM calls is only worth it for a document large enough that single-pass
// attention genuinely risks shortchanging later sections -- a document that's merely a little over
// one section's budget is exactly the case single-pass already handles well. 5 sections at the
// 6,000-char default budget is roughly a 30,000+ character document: a genuine multi-page report,
// not an ordinary long paste.
export const EXECUTION_NECESSITY_SECTION_THRESHOLD = 5
export const DOCUMENT_COMPREHENSION_EXECUTION_SECTION_THRESHOLD = 2

export function shouldExecuteHierarchicalComprehension(
  trace: DocumentComprehensionTrace,
  requestedOperation?: RequestedOperation,
): boolean {
  if (!trace.requiresHierarchicalComprehension) return false
  // Explicit document comprehension is a stronger signal that the user wants
  // cross-section synthesis. It lowers the execution bar from the generic
  // 5-section heuristic to 2 sections, but still requires an actual multi-section
  // source. The operation signal therefore strengthens the existing structural
  // length/section trigger rather than replacing it.
  const threshold = requestedOperation === 'document_comprehension'
    ? DOCUMENT_COMPREHENSION_EXECUTION_SECTION_THRESHOLD
    : EXECUTION_NECESSITY_SECTION_THRESHOLD
  return trace.sectionCount >= threshold
}

// Hard cap on how many sections get their own map call, independent of how many the document
// actually has -- bounds worst-case cost/latency for an extreme document rather than fanning out
// unboundedly. Sections beyond this cap are simply not covered by the synthesis; the caller is told
// via failureNotes so it can be honest about the gap rather than silently under-covering the source.
const MAX_SECTIONS_TO_EXECUTE = 8
const DEFAULT_TIME_BUDGET_MS = 30_000
// Below this, there isn't enough time to run even one round-trip safely -- skip rather than attempt
// a doomed pass that would just add latency without producing a usable synthesis.
const MIN_VIABLE_TIME_BUDGET_MS = 8_000
const MIN_STEP_TIMEOUT_MS = 4_000
const MAP_STEP_MAX_TOKENS = 500
const REDUCE_STEP_MAX_TOKENS = 2_000

export interface HierarchicalComprehensionResult {
  executed: boolean
  synthesis?: string
  sectionsProcessed: number
  sectionsFailed: number
  failureNotes: string[]
  durationMs: number
  // Recommendation 3 (2026-09-20): each successfully-extracted section's own text, exposed so a
  // downstream structural quality check (ceo-structural-quality-gate.ts) can verify the final answer
  // actually draws on the source's distinct sections -- not just that SOME synthesis was produced.
  // Only populated on the success path (executed:true); every failure/skip path has nothing structural
  // to offer beyond what failureNotes already says.
  sectionExtracts?: { sectionIndex: number; text: string }[]
}

function skip(failureNotes: string[], durationMs: number): HierarchicalComprehensionResult {
  return { executed: false, sectionsProcessed: 0, sectionsFailed: 0, failureNotes, durationMs }
}

/**
 * Executes a 'map_reduce' plan: one extraction call per section (bounded concurrency via the
 * runBounded helper above, with per-section failure isolation) followed by one reduce call
 * synthesizing every successful extraction. Returns executed:false -- never throws, except to
 * propagate a genuine request cancellation -- for a 'single_pass' plan (nothing to execute), an
 * insufficient time budget, every map call failing, or the reduce call itself failing; the caller's
 * job in every such case is simply to proceed without a synthesis, exactly as it would have before
 * this executor existed.
 */
export async function executeHierarchicalComprehension(plan: DocumentComprehensionPlan, options?: { signal?: AbortSignal; timeBudgetMs?: number }): Promise<HierarchicalComprehensionResult> {
  const started = Date.now()
  if (plan.strategy !== 'map_reduce' || !plan.reduceStep) return skip([], Date.now() - started)
  const timeBudgetMs = Math.max(0, options?.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS)
  if (timeBudgetMs < MIN_VIABLE_TIME_BUDGET_MS) return skip(['Insufficient time budget remaining for hierarchical comprehension; proceeding with the source document alone.'], Date.now() - started)
  const steps = plan.mapSteps.slice(0, MAX_SECTIONS_TO_EXECUTE)
  const truncatedSectionCount = plan.mapSteps.length - steps.length
  const failureNotes: string[] = truncatedSectionCount > 0 ? [`${truncatedSectionCount} additional section(s) beyond the first ${MAX_SECTIONS_TO_EXECUTE} were not covered by this synthesis (bounded execution limit).`] : []

  const mapBudgetMs = Math.floor(timeBudgetMs * 0.6)
  const reduceBudgetMs = timeBudgetMs - mapBudgetMs
  const mapBatches = Math.ceil(steps.length / 4)
  const perMapTimeoutMs = Math.max(MIN_STEP_TIMEOUT_MS, Math.floor(mapBudgetMs / Math.max(1, mapBatches)))
  const reduceTimeoutMs = Math.max(MIN_STEP_TIMEOUT_MS, reduceBudgetMs)
  // Deep-audit fix (2026-09-20): MIN_STEP_TIMEOUT_MS is a floor, not a proportional share of the
  // budget -- when timeBudgetMs is small relative to this plan's batch count (mapBatches, sequential
  // rounds of up to 4 concurrent map calls each), flooring every call up to at least
  // MIN_STEP_TIMEOUT_MS can push this plan's actual worst-case wall time (mapBatches * perMapTimeoutMs
  // + reduceTimeoutMs) above timeBudgetMs itself -- eating into time the caller (the primary generation
  // call in ceo-cognitive-lifecycle.ts, which recomputes its own timeout from whatever deadline remains
  // afterward) actually needs, exactly the outcome this executor's own module comment promises never to
  // cause ("can only ever help, never block or degrade a turn"). Checked against THIS plan's own
  // mapBatches rather than folded into a single MIN_VIABLE_TIME_BUDGET_MS constant, since
  // MAX_SECTIONS_TO_EXECUTE bounds mapBatches to at most 2 today but that bound is free to change
  // independently of this budget math.
  if (mapBatches * perMapTimeoutMs + reduceTimeoutMs > timeBudgetMs) return skip(['Insufficient time budget remaining for hierarchical comprehension given this document\'s section count; proceeding with the source document alone.'], Date.now() - started)

  const mapResults = await runBounded(steps, 4, async (step, index) => {
    const result = await runCanonicalLlm({
      messages: [{ role: 'user' as const, content: step.prompt }],
      taskType: 'analysis',
      executionClass: 'standard',
      temperature: 0.2,
      maxTokens: MAP_STEP_MAX_TOKENS,
      timeoutMs: perMapTimeoutMs,
      maxProviderAttempts: 1,
      signal: options?.signal,
    })
    return { index, content: result.content }
  })
  const mapOutputs: { sectionIndex: number; text: string }[] = []
  for (const outcome of mapResults) {
    const step = steps[outcome.index]
    if (!step) continue
    const text = outcome.content?.trim()
    if (text) mapOutputs.push({ sectionIndex: step.sectionIndex, text })
    else failureNotes.push(`Section ${step.sectionIndex + 1} of ${plan.trace.sectionCount} could not be processed and is not covered by this synthesis.`)
  }
  if (!mapOutputs.length) return { executed: false, sectionsProcessed: 0, sectionsFailed: steps.length, failureNotes: [...failureNotes, 'Every section extraction failed; no hierarchical synthesis was produced.'], durationMs: Date.now() - started }

  const reduceMessages = [
    { role: 'user' as const, content: plan.reduceStep.prompt },
    ...mapOutputs
      .sort((a, b) => a.sectionIndex - b.sectionIndex)
      .map((output) => ({ role: 'user' as const, content: `Extraction notes from section ${output.sectionIndex + 1} of ${plan.trace.sectionCount}:\n${output.text}` })),
  ]
  try {
    const reduceResult = await runCanonicalLlm({
      messages: reduceMessages,
      taskType: 'analysis',
      executionClass: 'standard',
      temperature: 0.3,
      maxTokens: REDUCE_STEP_MAX_TOKENS,
      timeoutMs: reduceTimeoutMs,
      maxProviderAttempts: 1,
      signal: options?.signal,
    })
    const synthesis = reduceResult.content.trim()
    if (!synthesis) return { executed: false, sectionsProcessed: mapOutputs.length, sectionsFailed: steps.length - mapOutputs.length, failureNotes: [...failureNotes, 'The synthesis step returned no content.'], durationMs: Date.now() - started }
    return { executed: true, synthesis, sectionsProcessed: mapOutputs.length, sectionsFailed: steps.length - mapOutputs.length, failureNotes, durationMs: Date.now() - started, sectionExtracts: mapOutputs }
  } catch (error) {
    if (isCeoRequestAborted(error)) throw error
    return { executed: false, sectionsProcessed: mapOutputs.length, sectionsFailed: steps.length - mapOutputs.length, failureNotes: [...failureNotes, `Synthesis step failed: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`], durationMs: Date.now() - started }
  }
}
