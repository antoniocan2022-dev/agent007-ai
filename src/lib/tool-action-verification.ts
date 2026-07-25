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
 *   1. orchestrator.ts — calls verifyToolAction() after each tool call
 *   2. quality_scorer_v2 — penalizes responses that rely on unverified actions
 *   3. Dashboard — shows ⚠️ Unverified action badge
 */
import type { ToolResult } from './tools'

export interface ToolVerificationResult {
  verified: boolean
  artifactType: 'url' | 'transaction_id' | 'message_id' | 'file_path' | 'data' | 'none'
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

  // Check for URL artifact
  const urlMatch = resultText.match(URL_PATTERN)
  if (urlMatch) {
    return {
      verified: true,
      artifactType: 'url',
      artifactValue: urlMatch[0],
      warning: null,
    }
  }

  // Check for transaction ID artifact
  const txMatch = resultText.match(TRANSACTION_ID_PATTERN)
  if (txMatch) {
    return {
      verified: true,
      artifactType: 'transaction_id',
      artifactValue: txMatch[0],
      warning: null,
    }
  }

  // Check for message ID artifact
  const msgMatch = resultText.match(MESSAGE_ID_PATTERN)
  if (msgMatch) {
    return {
      verified: true,
      artifactType: 'message_id',
      artifactValue: msgMatch[2],
      warning: null,
    }
  }

  // Check for file path artifact
  const fileMatch = resultText.match(FILE_PATH_PATTERN)
  if (fileMatch) {
    return {
      verified: true,
      artifactType: 'file_path',
      artifactValue: fileMatch[0],
      warning: null,
    }
  }

  // Check for "REAL" marker (UPGRADE #124 tools include "✅ This is REAL" in output)
  if (resultText.includes('✅') && (resultText.includes('REAL') || resultText.includes('real'))) {
    return {
      verified: true,
      artifactType: 'data',
      artifactValue: previewText.slice(0, 200),
      warning: null,
    }
  }

  // Tool claims success but no artifact found
  return {
    verified: false,
    artifactType: 'none',
    artifactValue: null,
    warning: `${toolName} returned success but no verifiable artifact was found. The action may not have actually occurred.`,
  }
}

/**
 * Format the verification result as a badge string for the UI.
 */
export function formatVerificationBadge(verification: ToolVerificationResult): string {
  if (verification.verified) {
    if (verification.artifactType === 'none') return ''  // No badge needed for non-action tools
    return `✅ VERIFIED (${verification.artifactType}: ${verification.artifactValue?.slice(0, 50) ?? ''})`
  }
  return `⚠️ UNVERIFIED — ${verification.warning ?? 'No artifact produced'}`
}

/**
 * Quality penalty for unverified actions.
 * Used by quality_scorer_v2 to penalize responses that rely on
 * unverified tool actions.
 *
 * Returns a penalty score (0-20) that gets subtracted from the quality score.
 */
export function calculateUnverifiedPenalty(
  verifications: ToolVerificationResult[]
): number {
  const unverified = verifications.filter((v) => !v.verified && v.warning)
  if (unverified.length === 0) return 0
  // Each unverified action costs 5 points, up to 20 max
  return Math.min(20, unverified.length * 5)
}
