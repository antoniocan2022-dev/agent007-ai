/**
 * reality-gate.ts — UPGRADE #120 (Finding 1)
 * ====================================================================
 * Wraps tools that claim to take real-world actions (publish, schedule,
 * send, create) and enforces HONESTY about what they actually do.
 *
 * THE PROBLEM (from external audit):
 *   ~560 of 620 tools are "VIRTUAL" — they return a canned success
 *   message without making any real API call. The agent reports
 *   "I scheduled your social media posts" when nothing was scheduled.
 *   This creates fictional progress.
 *
 * THE FIX:
 *   1. Reclassify every tool as REAL, CONDITIONAL, or INSTRUCTIONAL
 *   2. REAL tools: pass through (they make real API calls)
 *   3. CONDITIONAL tools: if API key is set, pass through; if not,
 *      return an HONEST message: "Tool not configured — set ENV_VAR
 *      to enable. This is a planning response, not a real action."
 *   4. INSTRUCTIONAL tools: always return an HONEST message:
 *      "This is a planning guide, not a real action. No API call was made."
 *
 * This wrapper is opt-in — tools call `realityGate()` before returning
 * their result. If the tool is VIRTUAL and claims success, the gate
 * rewrites the response to be honest.
 */
import type { ToolResult } from './tools'

export type ToolRealityLevel = 'REAL' | 'CONDITIONAL' | 'INSTRUCTIONAL'

export interface ToolRealityClassification {
  toolName: string
  level: ToolRealityLevel
  requiredEnvVar?: string  // for CONDITIONAL tools
  realApiUrl?: string      // documentation URL for wiring it up
  honestDescription: string // what the tool ACTUALLY does
}

/**
 * Registry of known VIRTUAL tools and their honest classifications.
 * This is the "truth" that prevents fictional success reporting.
 */
export const TOOL_REALITY_REGISTRY: Record<string, ToolRealityClassification> = {
  // ── INSTRUCTIONAL tools (never make API calls — just return guides) ──
  canva_design: {
    toolName: 'canva_design',
    level: 'INSTRUCTIONAL',
    honestDescription: 'Returns a Canva template URL + design instructions. Does NOT create any design via API. No design is produced.',
    realApiUrl: 'https://www.canva.dev/docs/connect/',
  },
  loom_video: {
    toolName: 'loom_video',
    level: 'INSTRUCTIONAL',
    honestDescription: 'Returns a Loom recording guide + script template. Does NOT record or upload any video. No video is produced.',
    realApiUrl: 'https://developer.loom.com/',
  },
  hootsuite_schedule: {
    toolName: 'hootsuite_schedule',
    level: 'CONDITIONAL',
    requiredEnvVar: 'HOOTSUITE_ACCESS_TOKEN',
    honestDescription: 'Returns a scheduling plan. Does NOT schedule any posts unless HOOTSUITE_ACCESS_TOKEN is set. No posts are scheduled.',
    realApiUrl: 'https://developer.hootsuite.com/',
  },
  ubersuggest_seo: {
    toolName: 'ubersuggest_seo',
    level: 'CONDITIONAL',
    requiredEnvVar: 'UBERSUGGEST_API_KEY',
    honestDescription: 'Returns SEO instructions. Does NOT fetch real keyword data unless UBERSUGGEST_API_KEY is set.',
    realApiUrl: 'https://app.neilpatel.com/en/ubersuggest/api',
  },
  ahrefs_seo: {
    toolName: 'ahrefs_seo',
    level: 'CONDITIONAL',
    requiredEnvVar: 'AHREFS_API_KEY',
    honestDescription: 'Returns SEO audit instructions. Does NOT fetch real backlink data unless AHREFS_API_KEY is set.',
    realApiUrl: 'https://ahrefs.com/api',
  },

  // ── CONDITIONAL tools (real if env var set, instructional if not) ──
  google_analytics: {
    toolName: 'google_analytics',
    level: 'CONDITIONAL',
    requiredEnvVar: 'GA4_PROPERTY_ID',
    honestDescription: 'Returns setup instructions. Says "Connected" if GA4_MEASUREMENT_ID exists, but does NOT query the GA4 Data API for real numbers unless GA4_PROPERTY_ID + GA4_API_KEY are set.',
    realApiUrl: 'https://developers.google.com/analytics/devguides/reporting/data/v1',
  },
  hotjar_analytics: {
    toolName: 'hotjar_analytics',
    level: 'INSTRUCTIONAL',
    honestDescription: 'Returns Hotjar setup instructions. Does NOT fetch heatmap or session data. No real analytics are retrieved.',
    realApiUrl: 'https://developer.hotjar.com/',
  },
  grammarly_check: {
    toolName: 'grammarly_check',
    level: 'INSTRUCTIONAL',
    honestDescription: 'Runs 6 basic regex checks (capitalize "I", "a lot", etc.). Does NOT call Grammarly API. This is a lightweight proofreader, not a real Grammarly integration.',
    realApiUrl: 'https://developer.grammarly.com/',
  },
}

/**
 * The Reality Gate — wraps a tool result and makes it HONEST.
 *
 * If the tool is in the registry and is VIRTUAL (INSTRUCTIONAL or
 * CONDITIONAL-without-key), the result is rewritten to clearly state
 * that no real action was taken.
 *
 * Usage:
 *   const result = await toolCanvaDesign(args)
 *   return realityGate('canva_design', result)
 */
export function realityGate(toolName: string, result: ToolResult): ToolResult {
  const classification = TOOL_REALITY_REGISTRY[toolName]
  if (!classification) {
    // Tool not in registry — assume it's real, pass through
    return result
  }

  // REAL tools pass through
  if (classification.level === 'REAL') {
    return result
  }

  // CONDITIONAL tools: check if the required env var is set
  if (classification.level === 'CONDITIONAL' && classification.requiredEnvVar) {
    const envVarSet = !!process.env[classification.requiredEnvVar]
    if (envVarSet) {
      // Env var is set — tool should be making real API calls.
      // Pass through (the tool itself checks the env var).
      return result
    }
    // Env var NOT set — this is a virtual response. Make it honest.
    return makeHonestResult(toolName, classification, result)
  }

  // INSTRUCTIONAL tools: always make honest
  return makeHonestResult(toolName, classification, result)
}

/**
 * Rewrite a tool result to be HONEST about what it actually did.
 */
function makeHonestResult(
  toolName: string,
  classification: ToolRealityClassification,
  originalResult: ToolResult
): ToolResult {
  const prefix = classification.level === 'CONDITIONAL'
    ? `⚠️ VIRTUAL TOOL (no ${classification.requiredEnvVar} env var set)`
    : '⚠️ INSTRUCTIONAL TOOL (no API call made)'

  const honestPreview = `${prefix}: ${toolName} did NOT take a real action. ${classification.honestDescription}`

  const honestResult = `${prefix}

WHAT THIS TOOL ACTUALLY DID:
${classification.honestDescription}

NO REAL-WORLD ACTION WAS TAKEN.
The agent should NOT report this as a completed action.

TO MAKE THIS TOOL REAL:
${classification.requiredEnvVar
  ? `1. Set the ${classification.requiredEnvVar} env var in Vercel`
  : '1. This tool requires custom API integration'}
${classification.realApiUrl
  ? `2. See API docs: ${classification.realApiUrl}`
  : '2. See the tool source code for integration points'}

ORIGINAL TOOL OUTPUT (for reference):
${originalResult.result.slice(0, 500)}`

  return {
    ok: true,  // The tool "worked" in the sense that it returned a response
    preview: honestPreview.slice(0, 200),
    result: honestResult,
  }
}

/**
 * Check if a tool is REAL (makes actual API calls).
 * Used by the mission artifact gate to decide if a tool's output
 * can be trusted as a verified artifact.
 */
export function isToolReal(toolName: string): boolean {
  const classification = TOOL_REALITY_REGISTRY[toolName]
  if (!classification) return true  // unknown tools assumed real
  if (classification.level === 'REAL') return true
  if (classification.level === 'CONDITIONAL' && classification.requiredEnvVar) {
    return !!process.env[classification.requiredEnvVar]
  }
  return false  // INSTRUCTIONAL tools are never real
}

/**
 * Get a list of all virtual (non-real) tools.
 * Used by the /api/health/reality-audit endpoint.
 */
export function listVirtualTools(): ToolRealityClassification[] {
  return Object.values(TOOL_REALITY_REGISTRY).filter((c) => !isToolReal(c.toolName))
}

/**
 * Get a list of all real tools.
 */
export function listRealTools(): string[] {
  return Object.keys(TOOL_REALITY_REGISTRY).filter((t) => isToolReal(t))
}
