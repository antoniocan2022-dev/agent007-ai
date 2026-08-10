/**
 * Canonical tool-dispatch boundary for Agent007.
 *
 * `src/lib/tools.ts` remains the implementation/registry module. This wrapper
 * is intentionally thin and is selected only for the `@/lib/tools` import
 * alias, so the authoritative orchestrator path cannot bypass the Autonomy
 * Governor accidentally.
 *
 * Safety rule: LLM-provided arguments never count as authorization evidence.
 * Only explicitly classified safe reads/internal bookkeeping are policy-approved
 * here. Everything else must satisfy the Governor's escalation rules.
 */

import {
  dispatchTool as rawDispatchTool,
  badResult,
  type ToolContext,
  type ToolResult,
} from './tools'
import { classifyToolExecution, autonomyDenialMessage } from './autonomy/autonomy-runtime'

export * from './tools'

const AUTONOMOUS_READ_TOOLS = new Set([
  'web_search',
  'page_reader',
  'image_gen',
  'vision',
  'memory_recall',
  'file_read',
  'file_read_any',
  'wikipedia_search',
  'wikipedia_read',
  'free_apis_directory',
  'kb_search',
  'source_read',
  'http_fetch',
  'ddg_search',
  'brave_search',
  'github_search',
  'reddit_search',
  'hn_search',
  'arxiv_search',
  'pubmed_search',
  'google_scholar_search',
  'semantic_scholar_search',
  'openalex_search',
  'core_search',
  'searxng_search',
  'tool_catalog',
  'tool_knowledge_base',
  'tool_capability_map',
  'tool_metadata_system',
  'tool_usage_analyzer',
  'tool_usage_analytics',
  'tool_boundary_audit',
])

// Internal bookkeeping/coordination that must remain usable by autonomous
// missions without turning arbitrary writes into autonomous authority.
const AUTONOMOUS_INTERNAL_WRITES = new Set([
  'memory_store',
  'progress_tracker',
  'report_progress',
  'request_help',
  'verify_work',
  'result_verifier',
  'result_verifier_v2',
  'quality_scorer',
  'quality_scorer_v2',
  'accuracy_checker',
  'tool_cache',
])

export async function dispatchTool(
  name: string,
  args: any,
  ctx: ToolContext,
): Promise<ToolResult> {
  const policyApproved = AUTONOMOUS_READ_TOOLS.has(name) || AUTONOMOUS_INTERNAL_WRITES.has(name)
  const decision = classifyToolExecution(name, args, {
    policyApproved,
    confidence: 1,
  })

  if (!decision.autonomous) {
    return badResult(autonomyDenialMessage(name, decision))
  }

  return rawDispatchTool(name, args, ctx)
}
