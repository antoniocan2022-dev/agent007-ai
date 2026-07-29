/**
 * model-router.ts — ⚠️ DEPRECATED (UPGRADE #172 audit)
 *
 * Originally intended (upgrade #52) to route to gpt-4o for complex tasks
 * and gpt-4o-mini for simple tasks. The functions `classifyTaskComplexity`
 * and `getModelConfig` are exported but NEVER imported anywhere in src/.
 * `llm-fallback.ts:21` hardcodes `gpt-4o` and ignores complexity.
 *
 * The intelligence boost (+15% on complex) and cost savings (-30% on
 * simple) that #52 promised were never realized. This file is 183 lines
 * of dead code.
 *
 * KEPT for now (might be referenced by external scripts). To activate:
 *   1. Import `getModelConfig` in llm-fallback.ts:124
 *   2. Use the returned model name instead of OPENAI_MODEL
 *   3. Wire `classifyTaskComplexity` into the agent's pre-LLM step
 *
 * To delete: confirm no scripts/ reference it, then `rm`.
 *
 * Also provides response caching for read-only tools (also unused).
 */

// ─── MODEL ROUTING ────────────────────────────────────────────────

type ModelTier = 'simple' | 'complex'

interface ModelConfig {
  model: string
  temperature: number
  max_tokens: number
  top_p: number
  presence_penalty: number
}

const MODEL_CONFIGS: Record<ModelTier, ModelConfig> = {
  simple: {
    model: process.env.OPENAI_MODEL_SIMPLE || 'gpt-4o-mini',
    temperature: 0.4,
    max_tokens: 2000,
    top_p: 0.9,
    presence_penalty: 0.1,
  },
  complex: {
    model: process.env.OPENAI_MODEL_COMPLEX || 'gpt-4o',
    temperature: 0.5,
    max_tokens: 4000,
    top_p: 0.92,
    presence_penalty: 0.15,
  },
}

/**
 * Classify a task as simple or complex to route to the right model.
 * Complex tasks get gpt-4o (smarter but slower + more expensive).
 * Simple tasks get gpt-4o-mini (fast + cheap).
 */
export function classifyTaskComplexity(userMessage: string): ModelTier {
  const msg = userMessage.toLowerCase()

  // Complex patterns → gpt-4o
  const complexPatterns = [
    'invest', 'portfolio', 'decision', 'analyz', 'strategy', 'plan',
    'compare', 'evaluate', 'assess', 'optimi', 'forecast', 'predict',
    'research', 'audit', 'design', 'architect', 'build me', 'create a',
    'write a report', 'legal', 'tax', 'compliance', 'risk',
    'multi-step', 'comprehensive', 'deep', 'exhaustive',
    'security', 'vulnerability', 'penetration', 'incident',
    'refactor', 'debug', 'architect', 'scale', 'business model',
  ]

  // Simple patterns → gpt-4o-mini
  const simplePatterns = [
    'hello', 'hi ', 'hey', 'thanks', 'ok', 'yes', 'no', 'done',
    'what is', 'who is', 'when', 'where', 'how much', 'price of',
    'status', 'list', 'show me', 'count',
  ]

  // Check for complex patterns first
  for (const p of complexPatterns) {
    if (msg.includes(p)) return 'complex'
  }

  // Check message length (longer = more complex)
  if (userMessage.length > 200) return 'complex'

  // Check for simple patterns
  for (const p of simplePatterns) {
    if (msg.includes(p)) return 'simple'
  }

  // Default: simple (most interactions are simple)
  return 'simple'
}

/**
 * Get the model config for a given task.
 */
export function getModelConfig(userMessage: string): ModelConfig {
  const tier = classifyTaskComplexity(userMessage)
  return MODEL_CONFIGS[tier]
}

// ─── RESPONSE CACHE ───────────────────────────────────────────────

interface CacheEntry {
  result: any
  expiresAt: number
}

const _cache: any = (globalThis as any).__toolCache || new Map<string, CacheEntry>()
if (!(globalThis as any).__toolCache) (globalThis as any).__toolCache = _cache

const CACHE_TTL_MS = 60 * 1000  // 60 seconds

// Tools that are safe to cache (read-only, no side effects)
const CACHEABLE_TOOLS = new Set([
  'web_search', 'ddg_search', 'brave_search', 'google_ai_search',
  'perplexity_ai_search', 'copilot_search', 'chatgpt_search',
  'you_com_search', 'brave_ai_search',
  'page_reader', 'http_fetch', 'inspect_url',
  'wikipedia_search', 'wikipedia_read', 'wikipedia_rest',
  'arxiv_search', 'github_search', 'stackoverflow_search',
  'pubmed_search', 'reddit_search', 'hn_search',
  'producthunt_search', 'google_scholar_search',
  'real_time_data_hub', 'real_time_market_analyzer',
  'kpi_performance_monitor', 'quantum_portfolio_tracker',
  'compliance_legal_manager', 'data_integration_hub',
  'user_engagement_analyzer', 'decision_feedback_loop',
  'kpi_dashboard_builder', 'automated_reporting_dashboard',
  'tool_catalog', 'tool_usage_tracker', 'tool_usage_analyzer',
  'list_tools', 'view_capabilities', 'view_manifest',
])

/**
 * Generate a cache key from tool name + args.
 */
function getCacheKey(toolName: string, args: any): string {
  try {
    return `${toolName}:${JSON.stringify(args)}`
  } catch {
    return `${toolName}:${String(args)}`
  }
}

/**
 * Check if a tool is cacheable (read-only).
 */
export function isCacheable(toolName: string): boolean {
  return CACHEABLE_TOOLS.has(toolName)
}

/**
 * Get a cached result. Returns null if not cached or expired.
 */
export function getCachedResult(toolName: string, args: any): any | null {
  if (!isCacheable(toolName)) return null
  const key = getCacheKey(toolName, args)
  const entry = _cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    _cache.delete(key)
    return null
  }
  return entry.result
}

/**
 * Cache a tool result.
 */
export function setCachedResult(toolName: string, args: any, result: any): void {
  if (!isCacheable(toolName)) return
  const key = getCacheKey(toolName, args)
  _cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS })

  // Clean expired entries (every 100 inserts)
  if (_cache.size % 100 === 0) {
    for (const [k, v] of _cache) {
      if (Date.now() > v.expiresAt) _cache.delete(k)
    }
  }
}

/**
 * Clear the entire cache (e.g., after a deploy or manual refresh).
 */
export function clearCache(): void {
  _cache.clear()
}

/**
 * Get cache stats.
 */
export function getCacheStats(): { size: number; hitRate: number } {
  return { size: _cache.size, hitRate: 0 }  // hitRate tracked externally if needed
}
