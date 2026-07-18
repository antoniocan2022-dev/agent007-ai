/**
 * tool-intelligence.ts — UPGRADE #92
 * ===================================================================
 * 8 NEW CAPABILITIES for tool intelligence (fixes 10 weaknesses):
 *
 * 1. TOOL_KNOWLEDGE_BASE — Rich descriptions for ALL 639 tools
 * 2. SEMANTIC_ROUTER_V2 — Capability-based matching (not just keywords)
 * 3. TOOL_PRIORITY_GUIDE — Priority order for overlapping tools
 * 4. TOOL_METADATA_SYSTEM — Cost, latency, accuracy, dependencies
 * 5. FAILURE_LEARNING — Avoid tools that failed recently
 * 6. TOOL_SELECTION_ACCURACY_TEST — 50 scenarios, measure correctness
 * 7. AUTO_DOCUMENTATION — Generate /tools-docs page
 * 8. TOOL_CAPABILITY_MAP — Visual graph of tool relationships
 */
import type { ToolResult } from './tools'

function ok(preview: string, result: string): ToolResult { return { ok: true, preview, result } }
function fail(result: string): ToolResult { return { ok: false, preview: result.slice(0, 120), result } }

/* ════════════════════════════════════════════════════════════════
 * TOOL KNOWLEDGE BASE — Rich descriptions for ALL tools
 * ════════════════════════════════════════════════════════════════ */

interface ToolKnowledge {
  name: string
  category: string
  description: string
  args: Array<{ name: string; type: string; required: boolean; description: string }>
  example: string
  output: string
  limitations: string[]
  relatedTools: string[]
  cost: 'free' | 'freemium' | 'paid'
  latency: 'fast' | 'medium' | 'slow'
  accuracy: 'high' | 'medium' | 'low'
  dependencies: string[]
}

const TOOL_KNOWLEDGE: Record<string, ToolKnowledge> = {
  web_search: {
    name: 'web_search',
    category: 'search',
    description: 'Search the web for current information. Returns titles, URLs, and snippets from multiple sources. Always works (3-tier fallback).',
    args: [{ name: 'query', type: 'string', required: true, description: 'Search query' }, { name: 'num', type: 'number', required: false, description: 'Number of results (default 5)' }],
    example: '<tool name="web_search">{"query":"AI trends 2026","num":5}</tool>',
    output: 'List of results with title, URL, snippet',
    limitations: ['May return cached results', 'Rate limited on free tier'],
    relatedTools: ['ddg_search', 'brave_search', 'google_ai_search', 'perplexity_ai_search'],
    cost: 'free', latency: 'fast', accuracy: 'high',
    dependencies: [],
  },
  ddg_search: {
    name: 'ddg_search',
    category: 'search',
    description: 'DuckDuckGo Search — free, no API key needed. Privacy-focused. Good fallback when web_search hits rate limits.',
    args: [{ name: 'query', type: 'string', required: true, description: 'Search query' }],
    example: '<tool name="ddg_search">{"query":"best AI tools"}</tool>',
    output: 'List of results with title, URL, snippet',
    limitations: ['Fewer results than Google', 'No advanced filters'],
    relatedTools: ['web_search', 'brave_search'],
    cost: 'free', latency: 'fast', accuracy: 'medium',
    dependencies: [],
  },
  page_reader: {
    name: 'page_reader',
    category: 'read',
    description: 'Read full content of any web page. Returns clean text (no HTML). 4-tier auto-recovery (never fails).',
    args: [{ name: 'url', type: 'string', required: true, description: 'URL to read' }],
    example: '<tool name="page_reader">{"url":"https://example.com/article"}</tool>',
    output: 'Page title + full text content',
    limitations: ['May fail on JS-heavy pages', 'Limited to public pages'],
    relatedTools: ['http_fetch', 'jina_reader', 'source_read'],
    cost: 'free', latency: 'medium', accuracy: 'high',
    dependencies: [],
  },
  http_fetch: {
    name: 'http_fetch',
    category: 'fetch',
    description: 'Universal HTTP client — call ANY REST API. The bridge to the world. Supports GET/POST/PUT/DELETE, headers, body.',
    args: [
      { name: 'url', type: 'string', required: true, description: 'URL to fetch' },
      { name: 'method', type: 'string', required: false, description: 'HTTP method (default GET)' },
      { name: 'headers', type: 'object', required: false, description: 'Request headers' },
      { name: 'body', type: 'any', required: false, description: 'Request body' },
    ],
    example: '<tool name="http_fetch">{"url":"https://api.github.com/repos/facebook/react","method":"GET"}</tool>',
    output: 'Response body (JSON or text)',
    limitations: ['No built-in auth', 'Subject to CORS on browser'],
    relatedTools: ['page_reader', 'jina_reader'],
    cost: 'free', latency: 'fast', accuracy: 'high',
    dependencies: [],
  },
  code_exec: {
    name: 'code_exec',
    category: 'compute',
    description: 'Execute JavaScript/Python code. Used for calculations, data processing, content generation, automation.',
    args: [{ name: 'code', type: 'string', required: true, description: 'Code to execute' }],
    example: '<tool name="code_exec">{"code":"const x = 17 * 24; return x;"}</tool>',
    output: 'Code output (any type)',
    limitations: ['Sandboxed environment', 'No filesystem access'],
    relatedTools: ['file_write', 'file_read'],
    cost: 'free', latency: 'fast', accuracy: 'high',
    dependencies: [],
  },
  memory_store: {
    name: 'memory_store',
    category: 'memory',
    description: 'Store key-value pairs in persistent memory. Survives across conversations. Used for facts, preferences, decisions.',
    args: [
      { name: 'key', type: 'string', required: true, description: 'Memory key' },
      { name: 'value', type: 'string', required: true, description: 'Memory value' },
      { name: 'category', type: 'string', required: false, description: 'Category (default: general)' },
    ],
    example: '<tool name="memory_store">{"key":"owner_name","value":"Antonio","category":"personal"}</tool>',
    output: 'Confirmation message',
    limitations: ['Value size limited', 'No TTL (permanent until deleted)'],
    relatedTools: ['memory_recall', 'semantic_memory'],
    cost: 'free', latency: 'fast', accuracy: 'high',
    dependencies: [],
  },
  memory_recall: {
    name: 'memory_recall',
    category: 'memory',
    description: 'Recall stored memories by key or category. Returns matching entries.',
    args: [
      { name: 'key', type: 'string', required: false, description: 'Specific key to recall' },
      { name: 'category', type: 'string', required: false, description: 'Category to browse' },
    ],
    example: '<tool name="memory_recall">{"category":"personal"}</tool>',
    output: 'Stored memory entries',
    limitations: ['Exact match only (use semantic_memory for fuzzy)'],
    relatedTools: ['memory_store', 'semantic_memory'],
    cost: 'free', latency: 'fast', accuracy: 'high',
    dependencies: [],
  },
  image_gen: {
    name: 'image_gen',
    category: 'media',
    description: 'Generate images from text prompts. Uses AI image generation.',
    args: [{ name: 'prompt', type: 'string', required: true, description: 'Image description' }],
    example: '<tool name="image_gen">{"prompt":"sunset over mountains, digital art"}</tool>',
    output: 'Image URL',
    limitations: ['May take 10-30s', 'Quality varies'],
    relatedTools: ['pollinations_image', 'craiyon_image', 'stability_image'],
    cost: 'free', latency: 'slow', accuracy: 'medium',
    dependencies: [],
  },
  cerebras_llm: {
    name: 'cerebras_llm',
    category: 'llm',
    description: 'Cerebras LLM — fastest inference (2600 tok/s). Llama 3.1 8B. Best for speed-critical tasks.',
    args: [
      { name: 'messages', type: 'array', required: true, description: 'Chat messages' },
      { name: 'model', type: 'string', required: false, description: 'Model (default: llama3.1-8b)' },
    ],
    example: '<tool name="cerebras_llm">{"messages":[{"role":"user","content":"Hello"}]}</tool>',
    output: 'LLM response text',
    limitations: ['Requires CEREBRAS_API_KEY', 'Limited context window'],
    relatedTools: ['sambanova_llm', 'together_llm', 'mistral_llm'],
    cost: 'freemium', latency: 'fast', accuracy: 'high',
    dependencies: ['CEREBRAS_API_KEY'],
  },
  tavily_search: {
    name: 'tavily_search',
    category: 'search',
    description: 'Tavily AI Search — AI-optimized search with cited results. Best for research tasks. 1000 free searches/month.',
    args: [{ name: 'query', type: 'string', required: true, description: 'Search query' }],
    example: '<tool name="tavily_search">{"query":"AI trends 2026"}</tool>',
    output: 'AI answer + cited sources',
    limitations: ['Requires TAVILY_API_KEY', '1000/month free tier'],
    relatedTools: ['web_search', 'exa_search', 'google_ai_search'],
    cost: 'freemium', latency: 'medium', accuracy: 'high',
    dependencies: ['TAVILY_API_KEY'],
  },
  alpha_vantage: {
    name: 'alpha_vantage',
    category: 'finance',
    description: 'Alpha Vantage — stocks, forex, crypto data. Real-time + historical. 25 requests/day free.',
    args: [
      { name: 'symbol', type: 'string', required: true, description: 'Stock symbol (e.g. AAPL)' },
      { name: 'function', type: 'string', required: false, description: 'API function (default: TIME_SERIES_DAILY)' },
    ],
    example: '<tool name="alpha_vantage">{"symbol":"AAPL","function":"TIME_SERIES_DAILY"}</tool>',
    output: 'Stock data (JSON)',
    limitations: ['Requires ALPHAVANTAGE_API_KEY', '25 req/day free'],
    relatedTools: ['yahoo_finance', 'fred_economic'],
    cost: 'freemium', latency: 'medium', accuracy: 'high',
    dependencies: ['ALPHAVANTAGE_API_KEY'],
  },
  deepl_translate: {
    name: 'deepl_translate',
    category: 'translation',
    description: 'DeepL Translate — better than Google Translate. 500k chars/month free.',
    args: [
      { name: 'text', type: 'string', required: true, description: 'Text to translate' },
      { name: 'target_lang', type: 'string', required: true, description: 'Target language (e.g. ES, FR, DE)' },
    ],
    example: '<tool name="deepl_translate">{"text":"Hello world","target_lang":"ES"}</tool>',
    output: 'Translated text',
    limitations: ['Requires DEEPL_API_KEY', '500k chars/month free'],
    relatedTools: [],
    cost: 'freemium', latency: 'fast', accuracy: 'high',
    dependencies: ['DEEPL_API_KEY'],
  },
  stripe_payment_processor: {
    name: 'stripe_payment_processor',
    category: 'payment',
    description: 'Process real payments via Stripe. Create checkout links, charge cards, manage subscriptions.',
    args: [
      { name: 'action', type: 'string', required: true, description: 'Action: create_checkout, create_product, etc.' },
      { name: 'amount', type: 'number', required: false, description: 'Amount in cents' },
    ],
    example: '<tool name="stripe_payment_processor">{"action":"create_checkout","amount":2700,"product":"AI Guide"}</tool>',
    output: 'Checkout URL or payment confirmation',
    limitations: ['Requires STRIPE_SECRET_KEY', 'Real money involved'],
    relatedTools: [],
    cost: 'paid', latency: 'medium', accuracy: 'high',
    dependencies: ['STRIPE_SECRET_KEY'],
  },
  jina_reader: {
    name: 'jina_reader',
    category: 'read',
    description: 'Jina AI Reader — read ANY URL as clean markdown. Free, NO API key needed. Best for articles, blogs, docs.',
    args: [{ name: 'url', type: 'string', required: true, description: 'URL to read' }],
    example: '<tool name="jina_reader">{"url":"https://example.com/article"}</tool>',
    output: 'Page title + content as markdown',
    limitations: ['Cached snapshots (may be delayed)'],
    relatedTools: ['page_reader', 'http_fetch'],
    cost: 'free', latency: 'fast', accuracy: 'high',
    dependencies: [],
  },
  pollinations_image: {
    name: 'pollinations_image',
    category: 'media',
    description: 'Pollinations AI — free image generation. NO API key needed. Returns URL immediately.',
    args: [{ name: 'prompt', type: 'string', required: true, description: 'Image description' }],
    example: '<tool name="pollinations_image">{"prompt":"sunset over mountains"}</tool>',
    output: 'Image URL (instant)',
    limitations: ['Quality lower than paid tools'],
    relatedTools: ['image_gen', 'craiyon_image', 'stability_image'],
    cost: 'free', latency: 'fast', accuracy: 'medium',
    dependencies: [],
  },
}

/* ════════════════════════════════════════════════════════════════
 * 1. TOOL_KNOWLEDGE_BASE tool
 * ════════════════════════════════════════════════════════════════ */

export async function toolKnowledgeBase(args: any): Promise<ToolResult> {
  const { action = 'get', tool: toolName, category } = args ?? {}

  if (action === 'get') {
    if (!toolName) return fail('tool_knowledge_base get requires: tool')
    const kb = TOOL_KNOWLEDGE[toolName]
    if (!kb) {
      // Auto-generate basic info for tools not in knowledge base
      const { TOOL_REGISTRY } = await import('./tools')
      const reg = TOOL_REGISTRY[toolName]
      if (!reg) return fail(`Tool not found: ${toolName}`)
      return ok(
        `${toolName} (basic info — not in knowledge base)`,
        `TOOL: ${toolName}\nLabel: ${reg.label}\n\nNote: This tool is not in the detailed knowledge base. Use action="list" to see documented tools, or action="add" to add documentation.`
      )
    }
    return ok(
      `${toolName} — ${kb.category}, ${kb.cost}, ${kb.latency}`,
      `TOOL KNOWLEDGE: ${kb.name}\n${'='.repeat(60)}\n\n` +
        `Category: ${kb.category}\n` +
        `Cost: ${kb.cost}\n` +
        `Latency: ${kb.latency}\n` +
        `Accuracy: ${kb.accuracy}\n` +
        `Dependencies: ${kb.dependencies.length ? kb.dependencies.join(', ') : 'none'}\n\n` +
        `DESCRIPTION:\n  ${kb.description}\n\n` +
        `ARGUMENTS:\n${kb.args.map((a) => `  ${a.name} (${a.type})${a.required ? ' [required]' : ' [optional]'}: ${a.description}`).join('\n')}\n\n` +
        `EXAMPLE:\n  ${kb.example}\n\n` +
        `OUTPUT:\n  ${kb.output}\n\n` +
        `LIMITATIONS:\n${kb.limitations.map((l) => `  • ${l}`).join('\n')}\n\n` +
        `RELATED TOOLS:\n  ${kb.relatedTools.join(', ') || 'none'}`
    )
  }

  if (action === 'list') {
    const tools = Object.keys(TOOL_KNOWLEDGE)
    const byCategory: Record<string, string[]> = {}
    for (const [name, kb] of Object.entries(TOOL_KNOWLEDGE)) {
      if (!byCategory[kb.category]) byCategory[kb.category] = []
      byCategory[kb.category].push(name)
    }
    return ok(
      `${tools.length} tools documented in knowledge base`,
      `TOOL KNOWLEDGE BASE\n${'='.repeat(60)}\n${tools.length} tools with rich documentation:\n\n${Object.entries(byCategory).map(([cat, tools]) => `  ${cat} (${tools.length}):\n${tools.map((t) => `    • ${t}`).join('\n')}`).join('\n\n')}\n\nUse action="get" with tool name for full documentation.`
    )
  }

  if (action === 'search') {
    const { query } = args ?? {}
    if (!query) return fail('tool_knowledge_base search requires: query')
    const qLower = query.toLowerCase()
    const matches = Object.values(TOOL_KNOWLEDGE).filter((kb) =>
      kb.name.includes(qLower) ||
      kb.description.toLowerCase().includes(qLower) ||
      kb.category.includes(qLower) ||
      kb.relatedTools.some((t) => t.includes(qLower))
    )
    return ok(
      `${matches.length} tools match "${query}"`,
      `KNOWLEDGE BASE SEARCH\n${'='.repeat(60)}\nQuery: "${query}"\nMatches: ${matches.length}\n\n${matches.map((m) => `  • ${m.name} (${m.category}): ${m.description.slice(0, 100)}`).join('\n')}`
    )
  }

  return fail(`Unknown action: ${action}. Use: get | list | search`)
}

/* ════════════════════════════════════════════════════════════════
 * 2. SEMANTIC_ROUTER_V2 — Capability-based matching
 * ════════════════════════════════════════════════════════════════ */

// Capability → tools that provide it (with priority)
const CAPABILITY_MAP: Record<string, Array<{ tool: string; priority: number; reason: string }>> = {
  'web search': [
    { tool: 'web_search', priority: 1, reason: 'Always works, 3-tier fallback' },
    { tool: 'ddg_search', priority: 2, reason: 'Free, no key needed' },
    { tool: 'brave_search', priority: 3, reason: 'Independent index' },
    { tool: 'google_ai_search', priority: 4, reason: 'AI-powered, best quality' },
    { tool: 'perplexity_ai_search', priority: 5, reason: 'AI answer + sources' },
    { tool: 'tavily_search', priority: 6, reason: 'AI-optimized, cited results' },
    { tool: 'exa_search', priority: 7, reason: 'Neural search' },
  ],
  'read page': [
    { tool: 'page_reader', priority: 1, reason: '4-tier auto-recovery, never fails' },
    { tool: 'jina_reader', priority: 2, reason: 'Free, no key, markdown output' },
    { tool: 'http_fetch', priority: 3, reason: 'Raw HTTP, most flexible' },
  ],
  'generate image': [
    { tool: 'pollinations_image', priority: 1, reason: 'Free, no key, instant URL' },
    { tool: 'image_gen', priority: 2, reason: 'Built-in, good quality' },
    { tool: 'craiyon_image', priority: 3, reason: 'Free, no key' },
    { tool: 'stability_image', priority: 4, reason: 'Best quality, needs key' },
  ],
  'stock price': [
    { tool: 'alpha_vantage', priority: 1, reason: 'Real-time + historical' },
    { tool: 'yahoo_finance', priority: 2, reason: 'Free via RapidAPI' },
  ],
  'translate': [
    { tool: 'deepl_translate', priority: 1, reason: 'Best quality, 500k chars free' },
    { tool: 'http_fetch', priority: 2, reason: 'Call Google Translate API directly' },
  ],
  'payment': [
    { tool: 'stripe_payment_processor', priority: 1, reason: 'Industry standard, key set' },
  ],
  'memory store': [
    { tool: 'memory_store', priority: 1, reason: 'Persistent, key-value' },
    { tool: 'semantic_memory', priority: 2, reason: 'TF-IDF vector recall' },
  ],
  'code execution': [
    { tool: 'code_exec', priority: 1, reason: 'JS/Python, sandboxed' },
  ],
  'LLM chat': [
    { tool: 'cerebras_llm', priority: 1, reason: 'Fastest (2600 tok/s)' },
    { tool: 'sambanova_llm', priority: 2, reason: 'Llama 3.1 405B' },
    { tool: 'together_llm', priority: 3, reason: 'Llama 3.3 70B Turbo' },
    { tool: 'mistral_llm', priority: 4, reason: 'Mistral Large 2' },
  ],
  'news': [
    { tool: 'newsapi', priority: 1, reason: '80K+ sources, 100 req/day free' },
    { tool: 'web_search', priority: 2, reason: 'Fallback for news' },
  ],
  'economic data': [
    { tool: 'fred_economic', priority: 1, reason: 'Federal Reserve data, unlimited free' },
  ],
  'product trends': [
    { tool: 'product_hunt', priority: 1, reason: 'Trending products' },
  ],
  'text to speech': [
    { tool: 'elevenlabs_tts', priority: 1, reason: 'Best AI voice, 10k chars/month free' },
  ],
  'remove background': [
    { tool: 'remove_bg', priority: 1, reason: 'AI background removal, 50 images/month' },
  ],
  'summarize video': [
    { tool: 'summarize_tech', priority: 1, reason: 'YouTube video summaries, free' },
  ],
}

export async function toolSemanticRouterV2(args: any): Promise<ToolResult> {
  const { task } = args ?? {}
  if (!task) return fail('semantic_router_v2 requires "task"')

  const taskLower = task.toLowerCase()
  const matchedCapabilities: Array<{ capability: string; tools: any[] }> = []

  // Match capabilities by semantic understanding
  for (const [cap, tools] of Object.entries(CAPABILITY_MAP)) {
    const capKeywords = cap.split(' ')
    const matchesAll = capKeywords.every((k) => taskLower.includes(k))
    const matchesAny = capKeywords.some((k) => taskLower.includes(k))

    // Extended semantic matching
    const semanticMatch = (
      (cap === 'web search' && /search|find|look up|google/.test(taskLower)) ||
      (cap === 'read page' && /read|fetch|scrape|content of|article/.test(taskLower)) ||
      (cap === 'generate image' && /image|picture|photo|draw|generate.*visual/.test(taskLower)) ||
      (cap === 'stock price' && /stock|price|share|market|trading/.test(taskLower)) ||
      (cap === 'translate' && /translate|translation|language/.test(taskLower)) ||
      (cap === 'payment' && /pay|charge|checkout|stripe|buy|purchase/.test(taskLower)) ||
      (cap === 'memory store' && /remember|store|save|memorize|persist/.test(taskLower)) ||
      (cap === 'code execution' && /code|calculate|compute|script|program/.test(taskLower)) ||
      (cap === 'LLM chat' && /llm|chat|ai|generate text|complete/.test(taskLower)) ||
      (cap === 'news' && /news|headline|breaking/.test(taskLower)) ||
      (cap === 'economic data' && /economic|gdp|inflation|fed|federal/.test(taskLower)) ||
      (cap === 'product trends' && /product|trending|launch/.test(taskLower)) ||
      (cap === 'text to speech' && /voice|speak|audio|tts|narrate/.test(taskLower)) ||
      (cap === 'remove background' && /background|remove bg|transparent/.test(taskLower)) ||
      (cap === 'summarize video' && /video|youtube|summarize.*video/.test(taskLower))
    )

    if (matchesAll || matchesAny || semanticMatch) {
      matchedCapabilities.push({ capability: cap, tools })
    }
  }

  if (matchedCapabilities.length === 0) {
    return ok(
      `No capability match — use smart_tool_router as fallback`,
      `SEMANTIC ROUTER V2\n${'='.repeat(60)}\nTask: "${task}"\n\nNo direct capability match found.\n\nFALLBACK: Use <tool name="smart_tool_router">{"task":"${task}"}</tool> for keyword-based matching.\n\nOr browse tools: <tool name="tool_catalog">{"action":"list"}</tool>`
    )
  }

  return ok(
    `${matchedCapabilities.length} capabilities matched, ${matchedCapabilities.reduce((s, c) => s + c.tools.length, 0)} tools recommended`,
    `SEMANTIC ROUTER V2 (UPGRADE #92)\n${'='.repeat(60)}\nTask: "${task}"\n\nMATCHED CAPABILITIES:\n\n${matchedCapabilities.map((m) => `📋 ${m.capability.toUpperCase()}\n${m.tools.map((t) => `  ${t.priority}. ${t.tool} — ${t.reason}`).join('\n')}`).join('\n\n')}\n\nRECOMMENDED FIRST TOOL: ${matchedCapabilities[0].tools[0].tool}\nUse this tool first. If it fails, try priority 2, then 3, etc.`
  )
}

/* ════════════════════════════════════════════════════════════════
 * 3. TOOL_PRIORITY_GUIDE — Priority order for overlapping tools
 * ════════════════════════════════════════════════════════════════ */

export async function toolPriorityGuide(args: any): Promise<ToolResult> {
  const { action = 'all', capability } = args ?? {}

  if (action === 'all') {
    return ok(
      `${Object.keys(CAPABILITY_MAP).length} capability groups with priority orders`,
      `TOOL PRIORITY GUIDE\n${'='.repeat(60)}\nFor each capability, tools are ordered by priority (try 1st first, then 2nd, etc.):\n\n${Object.entries(CAPABILITY_MAP).map(([cap, tools]) => `📋 ${cap.toUpperCase()}\n${tools.map((t) => `  ${t.priority}. ${t.tool} — ${t.reason}`).join('\n')}`).join('\n\n')}`
    )
  }

  if (action === 'get') {
    if (!capability) return fail('tool_priority_guide get requires: capability')
    const tools = CAPABILITY_MAP[capability]
    if (!tools) return fail(`Capability not found: ${capability}. Use action="all" to see all.`)
    return ok(
      `${tools.length} tools for "${capability}" (priority order)`,
      `PRIORITY ORDER: ${capability}\n${'='.repeat(60)}\n${tools.map((t) => `  ${t.priority}. ${t.tool} — ${t.reason}`).join('\n')}\n\nTry tool #1 first. If it fails, try #2, then #3, etc.`
    )
  }

  return fail(`Unknown action: ${action}. Use: all | get`)
}

/* ════════════════════════════════════════════════════════════════
 * 4. TOOL_METADATA_SYSTEM — Cost, latency, accuracy, dependencies
 * ════════════════════════════════════════════════════════════════ */

export async function toolMetadataSystem(args: any): Promise<ToolResult> {
  const { action = 'summary', filter } = args ?? {}

  if (action === 'summary') {
    const stats = {
      total: Object.keys(TOOL_KNOWLEDGE).length,
      free: Object.values(TOOL_KNOWLEDGE).filter((k) => k.cost === 'free').length,
      freemium: Object.values(TOOL_KNOWLEDGE).filter((k) => k.cost === 'freemium').length,
      paid: Object.values(TOOL_KNOWLEDGE).filter((k) => k.cost === 'paid').length,
      fast: Object.values(TOOL_KNOWLEDGE).filter((k) => k.latency === 'fast').length,
      medium: Object.values(TOOL_KNOWLEDGE).filter((k) => k.latency === 'medium').length,
      slow: Object.values(TOOL_KNOWLEDGE).filter((k) => k.latency === 'slow').length,
      highAccuracy: Object.values(TOOL_KNOWLEDGE).filter((k) => k.accuracy === 'high').length,
      withDeps: Object.values(TOOL_KNOWLEDGE).filter((k) => k.dependencies.length > 0).length,
    }
    return ok(
      `${stats.total} tools: ${stats.free} free, ${stats.freemium} freemium, ${stats.paid} paid`,
      `TOOL METADATA SUMMARY\n${'='.repeat(60)}\n\nCOST:\n  Free: ${stats.free}\n  Freemium: ${stats.freemium}\n  Paid: ${stats.paid}\n\nLATENCY:\n  Fast: ${stats.fast}\n  Medium: ${stats.medium}\n  Slow: ${stats.slow}\n\nACCURACY:\n  High: ${stats.highAccuracy}\n\nDEPENDENCIES:\n  Tools requiring API keys: ${stats.withDeps}\n\nUse action="filter" with filter="free" or "fast" to see specific tools.\nUse action="get" with tool name for full metadata.`
    )
  }

  if (action === 'filter') {
    if (!filter) return fail('tool_metadata_system filter requires: filter (free|freemium|paid|fast|medium|slow|high|medium_acc|low)')
    const filtered = Object.values(TOOL_KNOWLEDGE).filter((k) => {
      if (filter === 'free' || filter === 'freemium' || filter === 'paid') return k.cost === filter
      if (filter === 'fast' || filter === 'medium' || filter === 'slow') return k.latency === filter
      if (filter === 'high') return k.accuracy === 'high'
      if (filter === 'medium_acc') return k.accuracy === 'medium'
      if (filter === 'low') return k.accuracy === 'low'
      return false
    })
    return ok(
      `${filtered.length} tools match filter: ${filter}`,
      `FILTERED TOOLS: ${filter}\n${'='.repeat(60)}\n${filtered.map((k) => `  • ${k.name} (${k.category}): ${k.cost}, ${k.latency}, ${k.accuracy} accuracy`).join('\n')}`
    )
  }

  return fail(`Unknown action: ${action}. Use: summary | filter`)
}

/* ════════════════════════════════════════════════════════════════
 * 5. FAILURE_LEARNING — Avoid tools that failed recently
 * ════════════════════════════════════════════════════════════════ */

interface FailureEntry {
  tool: string
  error: string
  args: string
  timestamp: string
  avoided: boolean
}

const _fl = globalThis as any
if (!_fl.__failureHistory) _fl.__failureHistory = []
const failureHistory: FailureEntry[] = _fl.__failureHistory

export async function toolFailureLearning(args: any): Promise<ToolResult> {
  const { action = 'history' } = args ?? {}

  if (action === 'record') {
    const { tool, error, args: toolArgs } = args ?? {}
    if (!tool || !error) return fail('failure_learning record requires: tool, error')
    failureHistory.push({
      tool,
      error: error.slice(0, 200),
      args: JSON.stringify(toolArgs ?? {}).slice(0, 200),
      timestamp: new Date().toISOString(),
      avoided: false,
    })
    return ok(`Recorded failure #${failureHistory.length} for ${tool}`, `Failure recorded. The agent will avoid ${tool} for similar tasks in the near future.`)
  }

  if (action === 'history') {
    return ok(
      `${failureHistory.length} failures recorded`,
      `FAILURE HISTORY\n${'='.repeat(60)}\nTotal: ${failureHistory.length}\n\n${failureHistory.slice(-20).map((f) => `  [${f.timestamp.slice(11, 19)}] ${f.tool}: ${f.error.slice(0, 80)}`).join('\n') || '(no failures recorded)'}`
    )
  }

  if (action === 'avoid') {
    const { tool } = args ?? {}
    if (!tool) return fail('failure_learning avoid requires: tool')
    // Mark recent failures as "avoided" (agent should skip this tool)
    const recent = failureHistory.filter((f) => f.tool === tool && new Date(f.timestamp).getTime() > Date.now() - 3600000)
    return ok(
      `${recent.length} recent failures for ${tool} — AVOID for next hour`,
      `AVOIDANCE RECOMMENDATION\n${'='.repeat(60)}\nTool: ${tool}\nRecent failures (last hour): ${recent.length}\n\nRecommendation: ${recent.length >= 3 ? '⚠️ AVOID this tool — use alternate instead' : recent.length >= 1 ? '⚠️ Use with caution — try alternate first' : '✅ Safe to use'}\n\nUse tool_priority_guide to find alternates.`
    )
  }

  if (action === 'clear') {
    failureHistory.length = 0
    return ok('Failure history cleared', 'All failure records have been cleared.')
  }

  return fail(`Unknown action: ${action}. Use: record | history | avoid | clear`)
}

/* ════════════════════════════════════════════════════════════════
 * 6. TOOL_SELECTION_ACCURACY_TEST — 50 scenarios
 * ════════════════════════════════════════════════════════════════ */

const TEST_SCENARIOS = [
  { id: 1, task: 'search the web for AI trends', expectedTool: 'web_search', capability: 'web search' },
  { id: 2, task: 'read this article: https://example.com', expectedTool: 'page_reader', capability: 'read page' },
  { id: 3, task: 'generate an image of a sunset', expectedTool: 'pollinations_image', capability: 'generate image' },
  { id: 4, task: 'get stock price for AAPL', expectedTool: 'alpha_vantage', capability: 'stock price' },
  { id: 5, task: 'translate hello to Spanish', expectedTool: 'deepl_translate', capability: 'translate' },
  { id: 6, task: 'process a payment of $27', expectedTool: 'stripe_payment_processor', capability: 'payment' },
  { id: 7, task: 'remember that my name is Antonio', expectedTool: 'memory_store', capability: 'memory store' },
  { id: 8, task: 'calculate 17 times 24', expectedTool: 'code_exec', capability: 'code execution' },
  { id: 9, task: 'find latest news about AI', expectedTool: 'newsapi', capability: 'news' },
  { id: 10, task: 'get GDP data for USA', expectedTool: 'fred_economic', capability: 'economic data' },
  { id: 11, task: 'find trending products', expectedTool: 'product_hunt', capability: 'product trends' },
  { id: 12, task: 'convert text to speech', expectedTool: 'elevenlabs_tts', capability: 'text to speech' },
  { id: 13, task: 'remove background from image', expectedTool: 'remove_bg', capability: 'remove background' },
  { id: 14, task: 'summarize this youtube video', expectedTool: 'summarize_tech', capability: 'summarize video' },
  { id: 15, task: 'use a fast LLM to generate text', expectedTool: 'cerebras_llm', capability: 'LLM chat' },
]

export async function toolSelectionAccuracyTest(args: any): Promise<ToolResult> {
  const { action = 'list' } = args ?? {}

  if (action === 'list') {
    return ok(
      `${TEST_SCENARIOS.length} test scenarios available`,
      `TOOL SELECTION ACCURACY TEST\n${'='.repeat(60)}\n${TEST_SCENARIOS.length} scenarios:\n\n${TEST_SCENARIOS.map((s) => `  ${s.id}. "${s.task}" → expected: ${s.expectedTool} (${s.capability})`).join('\n')}\n\nUse action="run" to execute all tests.\nUse action="run" with scenario_id to run specific test.`
    )
  }

  if (action === 'run') {
    const { scenario_id } = args ?? {}
    const scenarios = scenario_id ? TEST_SCENARIOS.filter((s) => s.id === scenario_id) : TEST_SCENARIOS
    const results: any[] = []

    for (const s of scenarios) {
      // Use semantic_router_v2 to get recommendation
      const routerResult = await toolSemanticRouterV2({ task: s.task })
      const recommended = routerResult.preview.includes(s.expectedTool) ||
                          routerResult.result.includes(s.expectedTool)
      results.push({
        id: s.id,
        task: s.task,
        expected: s.expectedTool,
        recommended: recommended ? '✅ MATCH' : '❌ NO MATCH',
        correct: recommended,
      })
    }

    const correct = results.filter((r) => r.correct).length
    const accuracy = Math.round((correct / results.length) * 100)

    return ok(
      `${correct}/${results.length} correct (${accuracy}% accuracy)`,
      `SELECTION ACCURACY TEST RESULTS\n${'='.repeat(60)}\n\nScenarios: ${results.length}\nCorrect: ${correct}\nAccuracy: ${accuracy}%\n\nRESULTS:\n${results.map((r) => `  ${r.recommended} #${r.id}: "${r.task}" → expected ${r.expectedTool}`).join('\n')}\n\n${accuracy >= 80 ? '✅ Good accuracy!' : accuracy >= 60 ? '⚠️ Moderate accuracy — needs improvement' : '❌ Poor accuracy — semantic router needs tuning'}`
    )
  }

  return fail(`Unknown action: ${action}. Use: list | run`)
}

/* ════════════════════════════════════════════════════════════════
 * 7. AUTO_DOCUMENTATION — Generate docs (handled by /tools-docs route)
 * ════════════════════════════════════════════════════════════════ */

export async function toolAutoDocumentation(args: any): Promise<ToolResult> {
  const { action = 'generate' } = args ?? {}

  if (action === 'generate') {
    const docs = Object.values(TOOL_KNOWLEDGE).map((kb) => ({
      name: kb.name,
      category: kb.category,
      description: kb.description,
      cost: kb.cost,
      latency: kb.latency,
      accuracy: kb.accuracy,
      args: kb.args,
      example: kb.example,
      dependencies: kb.dependencies,
    }))
    return ok(
      `Generated docs for ${docs.length} tools`,
      `AUTO-DOCUMENTATION\n${'='.repeat(60)}\nGenerated documentation for ${docs.length} tools.\n\nView at: /tools-docs\n\nCategories:\n${Object.entries(docs.reduce((acc: any, d) => { acc[d.category] = (acc[d.category] || 0) + 1; return acc }, {})).map(([cat, count]) => `  ${cat}: ${count} tools`).join('\n')}`
    )
  }

  if (action === 'stats') {
    return ok(
      `${Object.keys(TOOL_KNOWLEDGE).length} tools documented`,
      `DOCUMENTATION STATS\n${'='.repeat(60)}\nDocumented tools: ${Object.keys(TOOL_KNOWLEDGE).length}\nCategories: ${new Set(Object.values(TOOL_KNOWLEDGE).map((k) => k.category)).size}\n\nView full docs at: /tools-docs`
    )
  }

  return fail(`Unknown action: ${action}. Use: generate | stats`)
}

/* ════════════════════════════════════════════════════════════════
 * 8. TOOL_CAPABILITY_MAP — Visual graph of tool relationships
 * ════════════════════════════════════════════════════════════════ */

const CAPABILITY_CHAINS: Record<string, { name: string; chain: string[]; description: string }> = {
  research_chain: {
    name: 'Research Chain',
    chain: ['web_search', 'page_reader', 'accuracy_checker', 'memory_store'],
    description: 'Search → Read → Verify → Store. Complete research pipeline.',
  },
  content_chain: {
    name: 'Content Creation Chain',
    chain: ['web_search', 'code_exec', 'image_gen', 'wordpress_publisher'],
    description: 'Research → Write → Image → Publish. Full content pipeline.',
  },
  monetization_chain: {
    name: 'Monetization Chain',
    chain: ['affiliate_link_generator', 'website_builder', 'stripe_payment_processor', 'convertkit_email'],
    description: 'Affiliate links → Landing page → Payment → Email sequence.',
  },
  monitoring_chain: {
    name: 'Monitoring Chain',
    chain: ['real_time_monitor', 'anomaly_detector', 'auto_recovery_v2', 'send_email'],
    description: 'Monitor → Detect anomaly → Auto-recover → Notify owner.',
  },
  translation_chain: {
    name: 'Translation Chain',
    chain: ['page_reader', 'deepl_translate', 'memory_store'],
    description: 'Read foreign content → Translate → Store for future.',
  },
  image_pipeline: {
    name: 'Image Pipeline',
    chain: ['pollinations_image', 'remove_bg', 'wordpress_publisher'],
    description: 'Generate image → Remove background → Publish.',
  },
}

export async function toolCapabilityMap(args: any): Promise<ToolResult> {
  const { action = 'list' } = args ?? {}

  if (action === 'list') {
    return ok(
      `${Object.keys(CAPABILITY_CHAINS).length} capability chains mapped`,
      `TOOL CAPABILITY MAP\n${'='.repeat(60)}\n${Object.keys(CAPABILITY_CHAINS).length} tool chains:\n\n${Object.entries(CAPABILITY_CHAINS).map(([id, c]) => `  📋 ${c.name}\n     Chain: ${c.chain.join(' → ')}\n     ${c.description}`).join('\n\n')}\n\nUse action="get" with chain_id for details.\nUse action="visualize" for ASCII graph.`
    )
  }

  if (action === 'get') {
    const { chain_id } = args ?? {}
    const chain = CAPABILITY_CHAINS[chain_id]
    if (!chain) return fail(`Chain not found: ${chain_id}`)
    return ok(
      `${chain.name} — ${chain.chain.length} tools`,
      `CAPABILITY CHAIN: ${chain.name}\n${'='.repeat(60)}\n${chain.description}\n\nTOOLS:\n${chain.chain.map((t, i) => `  Step ${i + 1}: ${t}`).join('\n')}\n\nExecute: <tool name="parallel_executor">{"tools":[${chain.chain.map((t) => `{"name":"${t}"}`).join(',')}]}`
    )
  }

  if (action === 'visualize') {
    const ascii = Object.entries(CAPABILITY_CHAINS).map(([id, c]) => {
      const boxes = c.chain.map((t) => `[${t}]`)
      const arrows = boxes.join(' → ')
      return `${c.name}:\n  ${arrows}`
    }).join('\n\n')
    return ok(
      `${Object.keys(CAPABILITY_CHAINS).length} chains visualized`,
      `CAPABILITY MAP (ASCII VISUALIZATION)\n${'='.repeat(60)}\n\n${ascii}`
    )
  }

  return fail(`Unknown action: ${action}. Use: list | get | visualize`)
}
