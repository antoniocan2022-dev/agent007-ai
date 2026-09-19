/**
 * tool-action-verification.ts — UPGRADE #124 (Recommendation 3)
 * ====================================================================
 * Verifies that tools that claim to take real-world actions actually
 * produced a verifiable artifact (URL, transaction ID, message ID, etc.)
 *
 * If a tool returns "success" but no verifiable artifact, it's flagged
 * as "unverified" so the agent + owner know the action didn't actually
 * happen.
 *
 * Integration points:
 *   1. orchestrator.ts — calls verifyToolAction() after each tool call and persists the result onto
 *      OrchestratorRunResult.steps[].verification.
 *   2. CEO route/lifecycle handoff — reads the persisted result via isKnownActionTool() to distinguish
 *      a completed external action from an action that only returned ok:true without independent proof.
 *
 * Stage 5 fresh-audit finding (same migration, same day): this header used to also list
 * "quality_scorer_v2 — penalizes responses that rely on unverified actions" and "Dashboard — shows
 * ⚠️ Unverified action badge" as integration points. Neither ever existed: quality_scorer_v2
 * (max-autonomy-engine.ts's toolQualityScorerV2) is a completely separate, self-contained 10-dimension
 * heuristic scorer with no reference to this file at all, and no dashboard component ever read a
 * formatted badge from here -- the real SSE `tool_result` consumer (orchestrator.ts) sends the raw
 * `verified`/`warning` fields directly. The two functions those integration points described
 * (calculateUnverifiedPenalty, formatVerificationBadge) had zero callers anywhere in the codebase and
 * are removed below rather than kept as dead code describing integrations that were never built.
 *
 * Phase 2 fixes (external audit, 2026-09-19), issues 3 and 5:
 *
 *   Issue 5 — isKnownActionTool used to answer true for http_fetch/web_search/page_reader alongside
 *   genuine outcome-producing tools (payments, publishers, senders). Those three only ever READ
 *   external state; they never change anything in the world, so a successful call to one of them is
 *   not evidence of a completed real-world ACTION and must never count toward
 *   ceo-operational-direct-response.ts's LIVE_VERIFIED eligibility. isKnownActionTool now excludes
 *   them (see RESEARCH_TOOLS below); verifyToolAction itself is unchanged for them (still checks for
 *   an incidental artifact, e.g. for the SSE UI), only the "does this count as a verified ACTION"
 *   classification changed.
 *
 *   Issue 3 — this module used to accept ANY artifact shape (a URL, a tx id, a message id, ...) as
 *   proof for ANY tool, so a send_email call whose result text happened to contain a stray URL was
 *   "verified" even though a URL says nothing about whether an email was actually sent -- verifying
 *   artifact PRESENCE, not that the artifact is the kind of evidence the requested outcome actually
 *   produces. EXPECTED_ARTIFACT_TYPES now maps each outcome tool to the artifact shape(s) its real
 *   result is supposed to contain; a match of the wrong kind is reported as unverified with a warning
 *   naming the mismatch, not silently accepted. Tools with no entry (research tools, and any future
 *   tool this file hasn't been taught about yet) keep the original permissive any-artifact check --
 *   this narrows false positives, it never introduces new false negatives for tools it can't reason
 *   about yet.
 */
import type { ToolResult } from './tools'

export type ToolVerificationResultArtifactType = 'url' | 'transaction_id' | 'message_id' | 'file_path' | 'data' | 'none'

export interface ToolVerificationResult {
  verified: boolean
  artifactType: ToolVerificationResultArtifactType
  artifactValue: string | null
  warning: string | null
}

// Patterns that indicate a real artifact in the tool result
const URL_PATTERN = /https?:\/\/[^\s<>"']+/
const TRANSACTION_ID_PATTERN = /\b(tx|txn|pi|ch|in)_[a-zA-Z0-9]{8,}\b/i
const MESSAGE_ID_PATTERN = /\b(message_id|msg_id|messageId)[:\s]+["']?(\d+|[a-zA-Z0-9_-]{8,})["']?/i
const FILE_PATH_PATTERN = /\/(home|tmp|var|usr|src|app|download)[^\s"'<>]*/i

// Tools that are known to produce real artifacts when they succeed
const ACTION_TOOLS = new Set([
  'wordpress_publisher',
  'stripe_payment_processor',
  'etsy_integration',
  'send_email',
  'send_whatsapp',
  'send_sms',
  'telegram_notify',
  'ntfy_notify',
  'discord_notify',
  'resend_email',
  'convertkit_email',
  'buffer_scheduler',
  'file_write',
  'image_gen',
  'code_exec',
  'http_fetch',
  'web_search',
  'page_reader',
  // UPGRADE #124: tools that now produce real output
  'canva_design',       // now generates real images
  'grammarly_check',    // now runs real analysis
  'loom_video',         // now generates real scripts
  'google_analytics',   // now queries real GA4 API
  'hotjar_analytics',   // now redirects to GA4 API
])

// Tools that are explicitly instructional (no real action expected)
const INSTRUCTIONAL_TOOLS = new Set([
  'hootsuite_schedule',
  'ubersuggest_seo',
  'ahrefs_seo',
])

// Phase 2 fix, issue 5: read/research tools that succeed by returning information, never by changing
// something in the world -- a successful http_fetch/web_search/page_reader call is not evidence of a
// completed real-world ACTION, even though this module still checks their result text for an
// incidental artifact below (e.g. a URL, for the SSE UI). Kept as a subset of ACTION_TOOLS (not a
// separate set entirely) so verifyToolAction's existing artifact-detection behavior for them is
// unchanged -- only isKnownActionTool's "counts as a verified action" classification narrows.
const RESEARCH_TOOLS = new Set(['http_fetch', 'web_search', 'page_reader'])

// Phase 2 fix, issue 3: the specific artifact shape(s) each outcome tool's real result is expected to
// contain. A tool's success text matching some OTHER pattern (e.g. send_email's result happening to
// contain a URL instead of a message id) does not confirm the requested outcome -- verifyToolAction
// below checks against this list before accepting a match. A tool with no entry here falls back to
// the original "any recognized artifact shape counts" behavior, so this only ever narrows acceptance
// for the tools it explicitly knows about; it never rejects a tool it has no opinion on.
const EXPECTED_ARTIFACT_TYPES: Record<string, readonly ToolVerificationResultArtifactType[]> = {
  stripe_payment_processor: ['transaction_id'],
  send_email: ['message_id'],
  resend_email: ['message_id'],
  send_whatsapp: ['message_id'],
  send_sms: ['message_id'],
  telegram_notify: ['message_id'],
  ntfy_notify: ['message_id'],
  discord_notify: ['message_id', 'url'],
  convertkit_email: ['message_id'],
  wordpress_publisher: ['url'],
  etsy_integration: ['url'],
  buffer_scheduler: ['url', 'data'],
  file_write: ['file_path'],
  image_gen: ['file_path', 'url', 'data'],
  code_exec: ['file_path', 'data'],
  canva_design: ['url', 'data'],
  grammarly_check: ['data'],
  loom_video: ['url', 'data'],
  google_analytics: ['data'],
  hotjar_analytics: ['data'],
}

/**
 * Whether a tool counts as a verifiable, outcome-producing ACTION (a member of ACTION_TOOLS, minus
 * the read/research tools carved out by RESEARCH_TOOLS above) -- exported so a caller holding a
 * ToolVerificationResult can tell "genuinely unverified action" apart from "instructional tool, a
 * read/research tool, or a non-action tool that was never expected to produce an artifact", all of
 * which also report `verified: false`/`verified: true, artifactType: 'none'` from verifyToolAction
 * below but mean something different. The CEO execution handoff consumes this distinction.
 */
export function isResearchTool(toolName: string): boolean {
  return RESEARCH_TOOLS.has(toolName)
}

export function isKnownActionTool(toolName: string): boolean {
  return ACTION_TOOLS.has(toolName) && !RESEARCH_TOOLS.has(toolName)
}

export interface ToolExecutionVerificationSummary {
  knownActionSteps: number
  verifiedActionSteps: number
  unverifiedActionSteps: number
  failedActionSteps: number
  researchSteps: number
  successfulToolSteps: number
  hasUnverifiedAction: boolean
  allKnownActionsVerified: boolean
}

export function summarizeToolExecutionVerification(
  steps: ReadonlyArray<{
    toolName?: string
    toolResult?: { ok: boolean }
    verification?: Pick<ToolVerificationResult, 'verified'>
  }>,
): ToolExecutionVerificationSummary {
  const knownActions = steps.filter((step) => Boolean(step.toolName) && isKnownActionTool(step.toolName!))
  const researchSteps = steps.filter((step) => Boolean(step.toolName) && isResearchTool(step.toolName!)).length
  const failedActionSteps = knownActions.filter((step) => step.toolResult?.ok === false).length
  const verifiedActionSteps = knownActions.filter((step) => step.toolResult?.ok === true && step.verification?.verified === true).length
  const unverifiedActionSteps = knownActions.length - verifiedActionSteps
  const successfulToolSteps = steps.filter((step) => step.toolResult?.ok === true).length
  return {
    knownActionSteps: knownActions.length,
    verifiedActionSteps,
    unverifiedActionSteps,
    failedActionSteps,
    researchSteps,
    successfulToolSteps,
    hasUnverifiedAction: failedActionSteps > 0 || unverifiedActionSteps > 0,
    allKnownActionsVerified: knownActions.length > 0 && failedActionSteps === 0 && unverifiedActionSteps === 0,
  }
}

/**
 * Verify if a tool's result contains a verifiable artifact.
 *
 * @param toolName - the name of the tool that was called
 * @param result - the ToolResult returned by the tool
 * @returns ToolVerificationResult with verified status + artifact details
 */
export function verifyToolAction(toolName: string, result: ToolResult): ToolVerificationResult {
  // Instructional tools are never verified (they don't take real actions)
  if (INSTRUCTIONAL_TOOLS.has(toolName)) {
    return {
      verified: false,
      artifactType: 'none',
      artifactValue: null,
      warning: `${toolName} is an instructional tool — no real action was taken.`,
    }
  }

  // Non-action tools (memory_store, quality_scorer_v2, etc.) don't need verification
  if (!ACTION_TOOLS.has(toolName)) {
    return {
      verified: true,
      artifactType: 'none',
      artifactValue: null,
      warning: null,
    }
  }

  // If the tool failed, it's not verified
  if (!result.ok) {
    return {
      verified: false,
      artifactType: 'none',
      artifactValue: null,
      warning: `${toolName} returned an error — action did not complete.`,
    }
  }

  const resultText = result.result || ''
  const previewText = result.preview || ''
  const artifact = findFirstArtifact(resultText, previewText)

  if (!artifact) {
    // Tool claims success but no artifact found
    return {
      verified: false,
      artifactType: 'none',
      artifactValue: null,
      warning: `${toolName} returned success but no verifiable artifact was found. The action may not have actually occurred.`,
    }
  }

  // Phase 2 fix, issue 3: presence of SOME artifact is not the same as presence of the RIGHT kind of
  // artifact for what this specific tool's real outcome is supposed to produce -- a send_email result
  // containing a stray URL does not confirm an email was sent. Tools with no expected-type entry keep
  // the original permissive "any recognized artifact counts" behavior.
  const expectedTypes = EXPECTED_ARTIFACT_TYPES[toolName]
  if (expectedTypes && !expectedTypes.includes(artifact.type)) {
    return {
      verified: false,
      artifactType: artifact.type,
      artifactValue: artifact.value,
      warning: `${toolName} returned a ${artifact.type.replace('_', ' ')}, which does not confirm the specific outcome this tool is expected to produce (expected ${expectedTypes.join(' or ').replace(/_/g, ' ')}). The action may not have actually completed as requested.`,
    }
  }

  return {
    verified: true,
    artifactType: artifact.type,
    artifactValue: artifact.value,
    warning: null,
  }
}

// Extracted so both the expected-type check above and (for tools with no expected-type entry) the
// original permissive behavior share one artifact-detection pass instead of two independently
// maintained copies of the same five patterns.
function findFirstArtifact(resultText: string, previewText: string): { type: ToolVerificationResultArtifactType; value: string } | null {
  const urlMatch = resultText.match(URL_PATTERN)
  if (urlMatch) return { type: 'url', value: urlMatch[0] }

  const txMatch = resultText.match(TRANSACTION_ID_PATTERN)
  if (txMatch) return { type: 'transaction_id', value: txMatch[0] }

  const msgMatch = resultText.match(MESSAGE_ID_PATTERN)
  if (msgMatch) return { type: 'message_id', value: msgMatch[2] }

  const fileMatch = resultText.match(FILE_PATH_PATTERN)
  if (fileMatch) return { type: 'file_path', value: fileMatch[0] }

  // "REAL" marker (UPGRADE #124 tools include "✅ This is REAL" in output)
  if (resultText.includes('✅') && (resultText.includes('REAL') || resultText.includes('real'))) return { type: 'data', value: previewText.slice(0, 200) }

  return null
}
