/**
 * ai-search-engines.ts — 6 AI-search-engine-branded tools.
 *
 * Deep-audit fix: every one of these 6 tools previously did zero network I/O and always returned
 * `ok:true` with a hand-written template string (query-independent boilerplate, including literal
 * placeholder citations like "example-source-1.com") -- regardless of any env var, regardless of
 * the query. They were also misclassified as REAL_API by this codebase's own tool-catalog
 * self-audit (roadmap-implementations.ts) and presented to the SCOUT and VID Director subagents
 * as genuine research tools. Any "finding" ever attributed to one of these was fabricated.
 *
 * Fixed for real, without breaking the many existing call sites that reference these tool names
 * (subagent allowedTools lists, workflow templates in max-autonomy-engine.ts/autonomy-tools.ts,
 * tool-intelligence.ts recommendations):
 *   - perplexity_ai_search: real call to Perplexity's Sonar API (PERPLEXITY_API_KEY) -- genuine
 *     cited, real-time web synthesis, matching what this tool always claimed to be.
 *   - you_com_search: real call to the You.com Search API (YDC_API_KEY).
 *   - google_ai_search: real call to Google Programmable Search (GOOGLE_SEARCH_API_KEY +
 *     GOOGLE_SEARCH_CX) -- genuine Google-sourced results. Honestly labeled: this is Google
 *     Custom Search, not the "AI Overview" feature (Google does not offer that as a public API).
 *   - copilot_search / chatgpt_search: Microsoft and OpenAI do not expose either product's own
 *     search feature as a callable third-party API. These always honestly delegate to a real
 *     search engine instead (Tavily/SerpAPI/web_search, whichever is available), and say so
 *     plainly in the output rather than pretending to be the named consumer product.
 *   - brave_ai_search: delegates to the same real Brave Search API (BRAVE_API_KEY) used
 *     elsewhere in this codebase -- genuinely Brave's own index, just not a separate "AI
 *     Answers" endpoint (Brave does not expose that as a distinct public API).
 * Every path below performs a real network request when it returns ok:true. None fabricate
 * results, and every one honestly reports which real engine actually served the answer.
 */

import { ToolResult, ToolContext, okResult, badResult } from './tools'

function needKey(tool: string, envVar: string, url: string): ToolResult {
  return badResult(`${tool} requires ${envVar}. Get a key at ${url}, then set it in the runtime environment.`)
}

/**
 * Falls through a preferred list of already-real search tools (each genuinely network-backed;
 * see web-research audit) until one succeeds. Used as the honest fallback for search-engine
 * brands that have no public API of their own to call.
 */
async function delegateToRealSearch(query: string, preferredEngines: string[] = ['tavily_search', 'serpapi', 'web_search']): Promise<{ engineUsed: string; text: string } | null> {
  const { dispatchTool } = await import('./tools')
  for (const engine of preferredEngines) {
    try {
      const result = await dispatchTool(engine, { query, q: query }, { attachments: [], language: 'en' })
      if (result?.ok && result.result && result.result.trim().length > 0) return { engineUsed: engine, text: result.result }
    } catch { /* try the next engine */ }
  }
  return null
}

function delegatedReport(brand: string, query: string, reasonNoDirectApi: string, delegated: { engineUsed: string; text: string } | null): ToolResult {
  if (!delegated) {
    return badResult(`${brand}: no real search engine was reachable to answer "${query.slice(0, 80)}". ${reasonNoDirectApi}`)
  }
  const header = `${brand.toUpperCase()} — "${query}"\n${'='.repeat(60)}\n\n` +
    `HONEST NOTE: ${reasonNoDirectApi} This tool performs a real, live search via ${delegated.engineUsed} and returns its genuine results below -- it does not fabricate a "${brand}" answer.\n\n` +
    `REAL RESULTS (via ${delegated.engineUsed}):\n${'─'.repeat(60)}\n`
  return okResult(`${brand}: real results via ${delegated.engineUsed} for "${query.slice(0, 60)}"`, header + delegated.text)
}

/* ================================================================== */
/* 1. GOOGLE AI SEARCH — real Google Custom Search when configured     */
/* ================================================================== */
export async function toolGoogleAiSearch(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const query = (args?.query ?? '').toString().trim()
  if (!query) return badResult('google_ai_search requires "query" argument')

  const apiKey = process.env.GOOGLE_SEARCH_API_KEY
  const cx = process.env.GOOGLE_SEARCH_CX
  if (apiKey && cx) {
    try {
      const res = await fetch(`https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(apiKey)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) return badResult(`google_ai_search: Google Custom Search HTTP ${res.status}`)
      const data = await res.json()
      const items = Array.isArray(data.items) ? data.items : []
      const body = items.map((item: any, i: number) => `  [${i + 1}] ${item.title}\n      ${item.link}\n      ${item.snippet ?? ''}`).join('\n\n')
      return okResult(`Google Custom Search: ${items.length} real results for "${query.slice(0, 60)}"`,
        `GOOGLE CUSTOM SEARCH — "${query}"\n${'='.repeat(60)}\n\n` +
        `NOTE: This is Google's real Custom Search JSON API (genuine Google-indexed results). It is not Google's "AI Overview" feature -- Google does not offer that as a public third-party API.\n\n` +
        `RESULTS (${items.length}):\n${body || '(no results)'}`)
    } catch (e: any) {
      return badResult(`google_ai_search: ${e?.message ?? String(e)}`)
    }
  }

  const delegated = await delegateToRealSearch(query)
  return delegatedReport('Google AI Search', query, 'GOOGLE_SEARCH_API_KEY/GOOGLE_SEARCH_CX are not configured, and Google does not offer a public API for its own "AI Overview" feature.', delegated)
}

/* ================================================================== */
/* 2. PERPLEXITY AI SEARCH — real Perplexity Sonar API when configured */
/* ================================================================== */
export async function toolPerplexityAiSearch(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const query = (args?.query ?? '').toString().trim()
  if (!query) return badResult('perplexity_ai_search requires "query" argument')

  const key = process.env.PERPLEXITY_API_KEY
  if (!key) {
    const delegated = await delegateToRealSearch(query)
    return delegatedReport('Perplexity AI Search', query, 'PERPLEXITY_API_KEY is not set.', delegated)
  }

  try {
    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'sonar', messages: [{ role: 'user', content: query }] }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) return badResult(`perplexity_ai_search: HTTP ${res.status}`)
    const data = await res.json()
    const content = data?.choices?.[0]?.message?.content
    const citations: string[] = Array.isArray(data?.citations) ? data.citations : []
    if (typeof content !== 'string' || !content.trim()) return badResult('perplexity_ai_search: response contained no content')
    return okResult(`Perplexity: real cited answer for "${query.slice(0, 60)}"`,
      `PERPLEXITY AI SEARCH — "${query}"\n${'='.repeat(60)}\n\n${content}\n\n` +
      (citations.length ? `SOURCES (${citations.length}, real):\n${citations.map((c, i) => `  [${i + 1}] ${c}`).join('\n')}` : ''))
  } catch (e: any) {
    return badResult(`perplexity_ai_search: ${e?.message ?? String(e)}`)
  }
}

/* ================================================================== */
/* 3. COPILOT SEARCH — no public API; honest delegate                  */
/* ================================================================== */
export async function toolCopilotSearch(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const query = (args?.query ?? '').toString().trim()
  if (!query) return badResult('copilot_search requires "query" argument')
  const delegated = await delegateToRealSearch(query)
  return delegatedReport('Copilot Search', query, 'Microsoft does not offer a public API for Copilot\'s own search/answer feature.', delegated)
}

/* ================================================================== */
/* 4. CHATGPT SEARCH — no public API; honest delegate                  */
/* ================================================================== */
export async function toolChatgptSearch(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const query = (args?.query ?? '').toString().trim()
  if (!query) return badResult('chatgpt_search requires "query" argument')
  const delegated = await delegateToRealSearch(query)
  return delegatedReport('ChatGPT Search', query, 'OpenAI does not offer a public API for ChatGPT\'s own web-search feature.', delegated)
}

/* ================================================================== */
/* 5. YOU.COM SEARCH — real You.com Search API when configured         */
/* ================================================================== */
export async function toolYouComSearch(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const query = (args?.query ?? '').toString().trim()
  if (!query) return badResult('you_com_search requires "query" argument')

  const key = process.env.YDC_API_KEY
  if (!key) {
    const delegated = await delegateToRealSearch(query)
    return delegatedReport('You.com Search', query, 'YDC_API_KEY is not set.', delegated)
  }

  try {
    const res = await fetch(`https://api.ydc-index.io/search?query=${encodeURIComponent(query)}`, {
      headers: { 'X-API-Key': key },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return badResult(`you_com_search: HTTP ${res.status}`)
    const data = await res.json()
    const hits = Array.isArray(data?.hits) ? data.hits : []
    const body = hits.slice(0, 10).map((h: any, i: number) => `  [${i + 1}] ${h.title}\n      ${h.url}\n      ${(h.snippets ?? []).join(' ').slice(0, 300)}`).join('\n\n')
    return okResult(`You.com: ${hits.length} real results for "${query.slice(0, 60)}"`,
      `YOU.COM SEARCH — "${query}"\n${'='.repeat(60)}\n\nRESULTS (${hits.length}):\n${body || '(no results)'}`)
  } catch (e: any) {
    return badResult(`you_com_search: ${e?.message ?? String(e)}`)
  }
}

/* ================================================================== */
/* 6. BRAVE AI SEARCH — real Brave Search API when configured          */
/* ================================================================== */
export async function toolBraveAiSearch(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const query = (args?.query ?? '').toString().trim()
  if (!query) return badResult('brave_ai_search requires "query" argument')

  const key = process.env.BRAVE_API_KEY
  if (!key) {
    const delegated = await delegateToRealSearch(query, ['tavily_search', 'serpapi', 'ddg_search', 'web_search'])
    return delegatedReport('Brave AI Search', query, 'BRAVE_API_KEY is not set, and Brave does not offer a separate public API for its "AI Answers" feature (only its base web-search index).', delegated)
  }

  try {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': key },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return badResult(`brave_ai_search: HTTP ${res.status}`)
    const data = await res.json()
    const results = Array.isArray(data?.web?.results) ? data.web.results : []
    const body = results.slice(0, 10).map((r: any, i: number) => `  [${i + 1}] ${r.title}\n      ${r.url}\n      ${r.description ?? ''}`).join('\n\n')
    return okResult(`Brave: ${results.length} real results for "${query.slice(0, 60)}"`,
      `BRAVE SEARCH — "${query}"\n${'='.repeat(60)}\n\n` +
      `NOTE: Brave's real web-search index (its base API). Brave does not expose a separate public "AI Answers" API.\n\n` +
      `RESULTS (${results.length}):\n${body || '(no results)'}`)
  } catch (e: any) {
    return badResult(`brave_ai_search: ${e?.message ?? String(e)}`)
  }
}
