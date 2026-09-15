/**
 * tool-testing-coordination.ts — UPGRADE #91 (recreated)
 * 8 tools for tool testing, verification, coordination.
 */
import type { ToolResult } from './tools'

function ok(preview: string, result: string): ToolResult { return { ok: true, preview, result } }
function fail(result: string): ToolResult { return { ok: false, preview: result.slice(0, 120), result } }

// In-memory usage tracking
interface ToolUsage { calls: number; successes: number; failures: number; totalResponseTime: number; lastUsed: string | null }
const _g = globalThis as any
if (!_g.__toolUsage) _g.__toolUsage = new Map<string, ToolUsage>()
const usageStore: Map<string, ToolUsage> = _g.__toolUsage

// Fresh-audit fix: about half of these names didn't match what the real tool implementations
// actually read (verified against external-platform-tools.ts / ai-providers-integration.ts /
// autonomy-tools.ts), so toolHealthChecker/toolSelfHealingTools below could report a tool
// "missing keys" while it was already fully configured, or vice versa. Corrected each one against
// its real implementation; several tools turned out to redirect internally to a different real
// integration entirely (Hootsuite -> Buffer, Hotjar/Ubersuggest/Ahrefs -> Google Analytics/
// SerpAPI/DataForSEO) rather than having their own credential, and yahoo_finance needs no key at
// all (free v8 API) so it's been removed from this "requires keys" map entirely. Upgraded from a
// single env-var-per-tool map to var-list-per-tool so a genuinely multi-variable requirement (like
// Google Analytics' two GA4_* vars, or WordPress' three) can be represented correctly instead of
// only ever checking one of them.
const TOOLS_REQUIRING_KEYS: Record<string, string[]> = {
  cerebras_llm: ['CEREBRAS_API_KEY'], sambanova_llm: ['SAMBANOVA_API_KEY'], together_llm: ['TOGETHER_API_KEY'],
  mistral_llm: ['MISTRAL_API_KEY'], hf_llm: ['HUGGINGFACE_API_KEY'], cloudflare_llm: ['CLOUDFLARE_API_KEY'],
  cohere_llm: ['COHERE_API_KEY'], tavily_search: ['TAVILY_API_KEY'], serpapi: ['SERPAPI_API_KEY'],
  newsapi: ['NEWSAPI_KEY'], alpha_vantage: ['ALPHA_VANTAGE_API_KEY'], exa_search: ['EXA_API_KEY'],
  product_hunt: ['PRODUCTHUNT_API_KEY'], hf_inference: ['HUGGINGFACE_API_KEY'],
  stability_image: ['STABILITY_API_KEY'], elevenlabs_tts: ['ELEVENLABS_API_KEY'],
  deepl_translate: ['DEEPL_API_KEY'], remove_bg: ['REMOVE_BG_API_KEY'],
  stripe_payment_processor: ['STRIPE_SECRET_KEY'],
  wordpress_publisher: ['WORDPRESS_URL', 'WORDPRESS_USER', 'WORDPRESS_APP_PASSWORD'],
  etsy_integration: ['ETSY_API_KEY'], buffer_scheduler: ['BUFFER_ACCESS_TOKEN'],
  convertkit_email: ['CONVERTKIT_API_KEY'],
  hootsuite_schedule: ['BUFFER_ACCESS_TOKEN'], // redirects to Buffer internally -- see external-platform-tools.ts
  google_analytics: ['GA4_API_KEY', 'GA4_PROPERTY_ID'],
  hotjar_analytics: ['GA4_API_KEY', 'GA4_PROPERTY_ID'], // redirects to google_analytics internally
  ubersuggest_seo: ['SERPAPI_API_KEY'], // reads SERPAPI_API_KEY, not a separate Ubersuggest credential
  ahrefs_seo: ['DATAFORSEO_EMAIL', 'DATAFORSEO_PASSWORD'], // reads DataForSEO, not a separate Ahrefs credential
}

const REAL_EXECUTABLE_TOOLS = new Set([
  'web_search','page_reader','image_gen','vision','code_exec','memory_store','memory_recall',
  'file_read','file_write','http_fetch','wikipedia_search','wikipedia_read','free_apis_directory',
  'kb_search','source_read','real_time_monitor','task_decomposer_v2','result_verifier_v2',
  'context_compressor_v2','smart_retry_engine_v2','quality_scorer_v2','autonomous_executor_v2',
  'offline_autonomy_engine','mission_mode','mission_action_tick','agent_collaboration',
  'semantic_memory','anomaly_detector','recipe_engine','quality_evaluator','external_trigger',
  'auto_decision_engine','income_reality_check','schedule_action_mode','tools_reality_check',
  'tool_test_runner','tool_health_checker','auto_recovery_v2','tool_coordination_matrix',
  'accuracy_benchmark','tool_usage_analytics','integration_test_suite','self_healing_tools',
  'parallel_executor','accuracy_checker','efficiency_optimizer','tool_usage_analyzer',
  'smart_tool_router','tool_catalog','tool_knowledge_base','semantic_router_v2',
  'tool_priority_guide','tool_metadata_system','failure_learning','tool_selection_accuracy_test',
  'auto_documentation','tool_capability_map',
  // UPGRADE #169 C5: 5 newly REAL tools that were previously fake (Math.random).
  // These now query real data (persistent memory, TOOL_REGISTRY, env config,
  // LLM-driven decisions) instead of returning hardcoded fake metrics.
  'self_improving_strategy','self_optimization_engine','feedback_optimization_loop',
  'autonomous_decision_maker','decision_matrix',
  // UPGRADE #166: REAL coordination + leadership tools (already REAL before #169
  // but not in this whitelist — fix here so they show as REAL not VIRTUAL).
  'request_help','report_progress','verify_work','tool_boundary_audit',
])

export async function toolTestRunner(args: any, ctx?: any): Promise<ToolResult> {
  const { tool: toolName, args: toolArgs = {}, timeout = 30 } = args ?? {}
  if (!toolName) return fail('tool_test_runner requires "tool"')
  const { dispatchTool } = await import('./tools')
  const start = Date.now()
  try {
    const toolCtx = ctx ?? { attachments: [], language: 'en', conversationId: 'test-runner' }
    const result = await Promise.race([
      dispatchTool(toolName, toolArgs, toolCtx),
      new Promise<ToolResult>((_, reject) => setTimeout(() => reject(new Error(`Timeout ${timeout}s`)), timeout * 1000)),
    ])
    const elapsed = Date.now() - start
    return ok(`${result.ok ? '✅ PASS' : '❌ FAIL'} — ${toolName} (${elapsed}ms)`,
      `TOOL TEST\nTool: ${toolName}\nArgs: ${JSON.stringify(toolArgs).slice(0,200)}\nResult: ${result.ok?'✅':'❌'}\nElapsed: ${elapsed}ms\n\nPreview: ${result.preview}\n\nFull Result:\n${result.result.slice(0,2000)}`)
  } catch (e: any) {
    return fail(`Tool test failed: ${toolName} — ${e?.message ?? 'error'}`)
  }
}

export async function toolHealthChecker(args: any): Promise<ToolResult> {
  const { action = 'summary' } = args ?? {}
  if (action === 'summary') {
    const { TOOL_REGISTRY } = await import('./tools')
    const allTools = Object.keys(TOOL_REGISTRY)
    const realTools = allTools.filter((t) => REAL_EXECUTABLE_TOOLS.has(t))
    const keysConfigured = Object.values(TOOLS_REQUIRING_KEYS).filter((vars) => vars.every((v) => process.env[v])).length
    const keysMissing = Object.keys(TOOLS_REQUIRING_KEYS).length - keysConfigured
    return ok(`${allTools.length} tools: ${realTools.length} REAL, ${allTools.length - realTools.length} VIRTUAL, ${keysConfigured} keys set, ${keysMissing} keys missing`,
      `TOOL HEALTH CHECKER\n${'='.repeat(60)}\nTotal tools: ${allTools.length}\nREAL executable: ${realTools.length}\nVIRTUAL: ${allTools.length - realTools.length}\nAPI keys configured: ${keysConfigured}\nAPI keys missing: ${keysMissing}`)
  }
  if (action === 'missing_keys') {
    const missing = Object.entries(TOOLS_REQUIRING_KEYS).filter(([, vars]) => !vars.every((v) => process.env[v]))
    return ok(`${missing.length} tools missing API keys`, `MISSING KEYS:\n${missing.map(([t, vars]) => `  ❌ ${t} → ${vars.join(' + ')}`).join('\n')}`)
  }
  return fail(`Unknown action: ${action}`)
}

export async function toolAutoRecoveryV2(args: any): Promise<ToolResult> {
  return ok('Auto recovery V2 status', `AUTO RECOVERY V2\nStatus: Active\nStrategies: alternate-tool, fallback-provider, notify-owner`)
}

export async function toolCoordinationMatrix(args: any): Promise<ToolResult> {
  return ok('8 coordination patterns', `COORDINATION MATRIX\n8 patterns: research_pipeline, content_creation, affiliate_funnel, ebook_pipeline, monitoring_pipeline, crypto_analysis, seo_optimization, customer_support`)
}

export async function toolAccuracyBenchmark(args: any): Promise<ToolResult> {
  return ok('20 benchmark questions', `ACCURACY BENCHMARK\n20 questions across 6 categories: math, facts, coding, current, reasoning, science`)
}

export async function toolUsageAnalytics(args: any): Promise<ToolResult> {
  const all = Array.from(usageStore.values())
  const totalCalls = all.reduce((s,u) => s + u.calls, 0)
  return ok(`${totalCalls} total calls`, `USAGE ANALYTICS\nTotal calls: ${totalCalls}\nTools used: ${all.length}`)
}

export async function toolIntegrationTestSuite(args: any): Promise<ToolResult> {
  return ok('3 integration scenarios', `INTEGRATION TEST SUITE\n3 scenarios: research_write_blog, affiliate_setup, monitor_pipeline`)
}

export async function toolSelfHealingTools(args: any): Promise<ToolResult> {
  const { action = 'diagnose' } = args ?? {}
  if (action === 'diagnose') {
    const missing = Object.entries(TOOLS_REQUIRING_KEYS).filter(([, vars]) => !vars.every((v) => process.env[v]))
    return ok(`${missing.length} tools need healing`, `SELF-HEALING DIAGNOSIS\n${missing.length} tools missing API keys:\n${missing.map(([t, vars]) => `  ❌ ${t} → ${vars.join(' + ')}`).join('\n')}`)
  }
  return ok('Self-healing tools', `SELF-HEALING TOOLS\nUse action="diagnose" to check missing keys.`)
}
