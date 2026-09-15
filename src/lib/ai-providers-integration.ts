/**
 * External API tool adapters.
 * CEO/model execution belongs exclusively to the canonical provider control plane.
 * This module contains tool-level integrations only; it is intentionally not a
 * provider registry and must never participate in CEO model selection.
 */
import type { ToolResult } from './tools'

function ok(preview: string, result: string): ToolResult { return { ok: true, preview, result } }
function fail(result: string): ToolResult { return { ok: false, preview: result.slice(0, 120), result } }
function needKey(name: string, envVar: string, url: string): ToolResult { return fail(`${name} requires ${envVar} env var. Get a key at ${url}. Set it in the runtime environment.`) }

// Fresh-audit fix: tavily_search/serpapi have no caching or dedup, unlike web_search (tools.ts
// has its own 1-hour cache). multi_search_compare's defaultSearchEngines() auto-adds tavily the
// moment TAVILY_API_KEY is set, and delegateToRealSearch (ai-search-engines.ts) also tries tavily
// first for several other tools -- so one conversation turn can invisibly burn 2+ real calls
// against the same query, meaningful against SerpAPI's 100/month free tier. A short-lived,
// same-module cache (mirroring tools.ts's own pattern; can't import its private cache without a
// circular dependency, since tools.ts imports this file) closes that gap for repeat queries.
interface SearchCacheEntry { result: ToolResult; at: number }
const _searchCache = new Map<string, SearchCacheEntry>()
const SEARCH_CACHE_TTL_MS = 60 * 60 * 1000
async function cachedSearch(toolName: string, query: string, run: () => Promise<ToolResult>): Promise<ToolResult> {
  const key = `${toolName}:${query}`
  const cached = _searchCache.get(key)
  if (cached && Date.now() - cached.at < SEARCH_CACHE_TTL_MS) return cached.result
  const result = await run()
  if (result.ok) _searchCache.set(key, { result, at: Date.now() })
  return result
}
function requireMessages(args: any, toolName: string): { messages: any[] } | ToolResult {
  if (!Array.isArray(args?.messages) || args.messages.length === 0) return fail(`${toolName} requires a non-empty "messages" array`)
  return { messages: args.messages }
}
async function postOpenAICompatible(name: string, keyEnv: string, url: string, args: any, defaultModel: string): Promise<ToolResult> {
  const key = process.env[keyEnv]
  if (!key) return needKey(name, keyEnv, url)
  const validated = requireMessages(args, `${name.toLowerCase().replace(/\s+/g, '_')}_llm`)
  if ('ok' in validated) return validated
  const model = typeof args?.model === 'string' && args.model.trim() ? args.model.trim() : defaultModel
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ model, messages: validated.messages, temperature: args?.temperature ?? 0.3, max_tokens: args?.max_tokens ?? 8000 }), signal: AbortSignal.timeout(60000) })
    if (!response.ok) return fail(`${name}: HTTP ${response.status}`)
    const data = await response.json()
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) return fail(`${name}: response contained no assistant content`)
    return ok(content.slice(0, 80), `${name} (${model}):\n${content}`)
  } catch (error: any) { return fail(`${name}: ${error?.message ?? String(error)}`) }
}

/* ═══ LLM TOOL ADAPTERS (not CEO routing) ═══ */
export async function toolCerebrasLLM(args: any): Promise<ToolResult> { return postOpenAICompatible('Cerebras', 'CEREBRAS_API_KEY', 'https://cloud.cerebras.ai', args, 'gpt-oss-120b') }
export async function toolSambaNovaLLM(args: any): Promise<ToolResult> { return postOpenAICompatible('SambaNova', 'SAMBANOVA_API_KEY', 'https://sambanova.ai', args, 'Meta-Llama-3.1-405B-Instruct') }
export async function toolTogetherLLM(args: any): Promise<ToolResult> { return postOpenAICompatible('Together AI', 'TOGETHER_API_KEY', 'https://api.together.xyz/v1/chat/completions', args, 'meta-llama/Llama-3.3-70B-Instruct-Turbo') }
export async function toolMistralLLM(args: any): Promise<ToolResult> { return postOpenAICompatible('Mistral AI', 'MISTRAL_API_KEY', 'https://api.mistral.ai/v1/chat/completions', args, 'mistral-large-latest') }
export async function toolHuggingFaceLLM(args: any): Promise<ToolResult> {
  const key = process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY
  if (!key) return needKey('Hugging Face', 'HUGGINGFACE_API_KEY', 'https://huggingface.co/settings/tokens')
  const validated = requireMessages(args, 'hf_llm'); if ('ok' in validated) return validated
  const model = typeof args?.model === 'string' && args.model.trim() ? args.model.trim() : 'meta-llama/Llama-3.3-70B-Instruct'
  try {
    const response = await fetch(`https://api-inference.huggingface.co/models/${model}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ inputs: validated.messages.map((m: any) => `${m.role}: ${m.content}`).join('\n'), parameters: { temperature: args?.temperature ?? 0.3, max_new_tokens: args?.max_new_tokens ?? 8000 } }), signal: AbortSignal.timeout(60000) })
    if (!response.ok) return fail(`HuggingFace: HTTP ${response.status}`)
    const data = await response.json(); const content = Array.isArray(data) ? data[0]?.generated_text ?? '' : data?.generated_text ?? ''
    return ok(String(content).slice(0, 80) || 'ok', `HuggingFace (${model}):\n${content}`)
  } catch (error: any) { return fail(`HuggingFace: ${error?.message ?? String(error)}`) }
}
export async function toolCloudflareLLM(args: any): Promise<ToolResult> {
  const key = process.env.CLOUDFLARE_API_KEY; const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  if (!key || !accountId) return needKey('Cloudflare Workers AI', !key ? 'CLOUDFLARE_API_KEY' : 'CLOUDFLARE_ACCOUNT_ID', 'https://dash.cloudflare.com')
  const validated = requireMessages(args, 'cloudflare_llm'); if ('ok' in validated) return validated
  const model = typeof args?.model === 'string' && args.model.trim() ? args.model.trim() : '@cf/google/gemma-4-26b-a4b-it'
  try {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${encodeURIComponent(model)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ messages: validated.messages }), signal: AbortSignal.timeout(60000) })
    if (!response.ok) return fail(`Cloudflare: HTTP ${response.status}`)
    const data = await response.json(); const content = typeof data?.result?.response === 'string' ? data.result.response : typeof data?.result?.text === 'string' ? data.result.text : ''
    if (!content.trim()) return fail('Cloudflare: response contained no text')
    return ok(content.slice(0, 80), `Cloudflare (${model}):\n${content}`)
  } catch (error: any) { return fail(`Cloudflare: ${error?.message ?? String(error)}`) }
}
export async function toolCohereLLM(args: any): Promise<ToolResult> {
  const key = process.env.COHERE_API_KEY; if (!key) return needKey('Cohere', 'COHERE_API_KEY', 'https://dashboard.cohere.com')
  const validated = requireMessages(args, 'cohere_llm'); if ('ok' in validated) return validated
  const model = typeof args?.model === 'string' && args.model.trim() ? args.model.trim() : 'command-r-plus'
  try {
    const response = await fetch('https://api.cohere.ai/v1/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ model, message: validated.messages[validated.messages.length - 1]?.content ?? '', chat_history: validated.messages.slice(0, -1).map((m: any) => ({ role: m.role === 'assistant' ? 'CHATBOT' : 'USER', message: m.content })) }), signal: AbortSignal.timeout(60000) })
    if (!response.ok) return fail(`Cohere: HTTP ${response.status}`)
    const data = await response.json(); const content = data?.text ?? ''
    if (!content.trim()) return fail('Cohere: response contained no text')
    return ok(content.slice(0, 80), `Cohere (${model}):\n${content}`)
  } catch (error: any) { return fail(`Cohere: ${error?.message ?? String(error)}`) }
}

/* ═══ SEARCH / DATA / CONTENT TOOL COMPATIBILITY EXPORTS ═══
 * These were historically colocated here. Keep the stable exports so the
 * tool registry does not break while each tool remains independent of the CEO
 * provider control plane. */
async function getJson(url: string, headers: Record<string, string> = {}, label: string, timeoutMs = 10000): Promise<ToolResult> {
  try { const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) }); if (!response.ok) return fail(`${label}: HTTP ${response.status}`); const data = await response.json(); return ok(label, `${label}:\n${JSON.stringify(data).slice(0, 12000)}`) } catch (error: any) { return fail(`${label}: ${error?.message ?? String(error)}`) }
}
// Fresh-audit fix: tavily_search/serpapi/exa_search used to return raw JSON.stringify(data) as
// their whole result text. That's readable to the LLM but the evidence pipeline's URL extractor
// (ceo-evidence-executor.ts's urlsFromSearchResult) only recognizes the "URL: <link>" line format
// every other search tool in this codebase uses -- so a genuinely successful call here contributed
// zero evidence sources, silently. Format real result items with that same label instead of
// dumping the raw payload; fall back to the raw JSON only if no results parsed, so no information
// is ever lost even if a provider changes its response shape.
interface SearchItem { title: string; url: string; snippet?: string }
function formatSearchItems(brand: string, query: string, items: SearchItem[]): string {
  const body = items.map((item, i) => `  [${i + 1}] ${item.title || item.url}\n      URL: ${item.url}${item.snippet ? `\n      ${item.snippet.slice(0, 300)}` : ''}`).join('\n\n')
  return `${brand.toUpperCase()} — "${query}"\n${'='.repeat(60)}\n\nRESULTS (${items.length}):\n${body || '(no results)'}`
}
export async function toolTavilySearch(args: any): Promise<ToolResult> {
  const key = process.env.TAVILY_API_KEY; if (!key) return needKey('Tavily Search', 'TAVILY_API_KEY', 'https://tavily.com')
  const query = String(args?.query ?? '').trim(); if (!query) return fail('tavily_search requires "query"')
  return cachedSearch('tavily_search', query, async () => {
    try {
      const response = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: key, query, max_results: Math.min(Math.max(Number(args?.num ?? 5), 1), 10) }), signal: AbortSignal.timeout(10000) })
      if (!response.ok) return fail(`Tavily: HTTP ${response.status}`)
      const data = await response.json()
      const results = Array.isArray(data?.results) ? data.results : []
      const items: SearchItem[] = results.filter((r: any) => typeof r?.url === 'string').map((r: any) => ({ title: r.title, url: r.url, snippet: r.content }))
      if (!items.length) return ok('Tavily Search', JSON.stringify(data).slice(0, 12000))
      return ok(`Tavily Search: ${items.length} real results for "${query.slice(0, 60)}"`, formatSearchItems('Tavily Search', query, items))
    } catch (e: any) { return fail(`Tavily: ${e?.message ?? String(e)}`) }
  })
}
export async function toolSerpAPI(args: any): Promise<ToolResult> {
  const key = process.env.SERPAPI_API_KEY; if (!key) return needKey('SerpAPI', 'SERPAPI_API_KEY', 'https://serpapi.com')
  const q = String(args?.query ?? '').trim(); if (!q) return fail('serpapi_search requires "query"')
  return cachedSearch('serpapi', q, async () => {
    try {
      const response = await fetch(`https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(q)}&api_key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(10000) })
      if (!response.ok) return fail(`SerpAPI: HTTP ${response.status}`)
      const data = await response.json()
      const results = Array.isArray(data?.organic_results) ? data.organic_results : []
      const items: SearchItem[] = results.filter((r: any) => typeof r?.link === 'string').map((r: any) => ({ title: r.title, url: r.link, snippet: r.snippet }))
      if (!items.length) return ok('SerpAPI', JSON.stringify(data).slice(0, 12000))
      return ok(`SerpAPI: ${items.length} real results for "${q.slice(0, 60)}"`, formatSearchItems('SerpAPI', q, items))
    } catch (e: any) { return fail(`SerpAPI: ${e?.message ?? String(e)}`) }
  })
}
export async function toolNewsAPI(args: any): Promise<ToolResult> { const key = process.env.NEWSAPI_KEY || process.env.NEWS_API_KEY; if (!key) return needKey('NewsAPI', 'NEWSAPI_KEY', 'https://newsapi.org'); const q = String(args?.query ?? '').trim(); if (!q) return fail('newsapi_search requires "query"'); return getJson(`https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&pageSize=10&apiKey=${encodeURIComponent(key)}`, {}, 'NewsAPI') }
export async function toolAlphaVantage(args: any): Promise<ToolResult> { const key = process.env.ALPHA_VANTAGE_API_KEY; if (!key) return needKey('Alpha Vantage', 'ALPHA_VANTAGE_API_KEY', 'https://www.alphavantage.co'); const symbol = String(args?.symbol ?? '').trim(); if (!symbol) return fail('alpha_vantage requires "symbol"'); return getJson(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`, {}, 'Alpha Vantage') }
// Fresh-audit fix: closes the "financial news with sentiment" gap using the same ALPHA_VANTAGE_API_KEY
// already configured for toolAlphaVantage above -- no new credential needed. Alpha Vantage's
// NEWS_SENTIMENT endpoint returns real articles with per-article and per-ticker sentiment scores;
// formatted with "URL: <link>" labels per article to match this codebase's evidence-extraction
// convention (see urlsFromSearchResult in ceo-evidence-executor.ts).
export async function toolAlphaVantageNews(args: any): Promise<ToolResult> {
  const key = process.env.ALPHA_VANTAGE_API_KEY
  if (!key) return needKey('Alpha Vantage News', 'ALPHA_VANTAGE_API_KEY', 'https://www.alphavantage.co')
  const tickers = String(args?.tickers ?? args?.symbol ?? '').trim().toUpperCase()
  const topics = String(args?.topics ?? '').trim()
  if (!tickers && !topics) return fail('alpha_vantage_news requires "tickers" or "topics"')
  try {
    const params = new URLSearchParams({ function: 'NEWS_SENTIMENT', apikey: key, limit: String(Math.min(Math.max(Number(args?.limit ?? 20), 1), 50)) })
    if (tickers) params.set('tickers', tickers)
    if (topics) params.set('topics', topics)
    const response = await fetch(`https://www.alphavantage.co/query?${params.toString()}`, { signal: AbortSignal.timeout(15000) })
    if (!response.ok) return fail(`Alpha Vantage News: HTTP ${response.status}`)
    const data = await response.json()
    if (data?.Note || data?.Information) return fail(`Alpha Vantage News: ${data.Note || data.Information}`)
    const feed = Array.isArray(data?.feed) ? data.feed : []
    if (!feed.length) return ok('Alpha Vantage News: no articles found', JSON.stringify(data).slice(0, 4000))
    const shown = feed.slice(0, 20)
    const items = shown.map((a: any, i: number) => {
      const tickerSentiment = Array.isArray(a?.ticker_sentiment) ? a.ticker_sentiment.map((t: any) => `${t.ticker}: ${t.ticker_sentiment_label} (${t.ticker_sentiment_score})`).join(', ') : ''
      return `  [${i + 1}] ${a.title}\n      URL: ${a.url}\n      Source: ${a.source ?? 'unknown'} | Published: ${a.time_published ?? 'unknown'} | Overall sentiment: ${a.overall_sentiment_label ?? 'n/a'} (${a.overall_sentiment_score ?? 'n/a'})${tickerSentiment ? `\n      Per-ticker sentiment: ${tickerSentiment}` : ''}\n      ${String(a.summary ?? '').slice(0, 300)}`
    }).join('\n\n')
    return ok(`Alpha Vantage News: ${feed.length} real article(s)${tickers ? ` for ${tickers}` : ''}`, `ALPHA VANTAGE NEWS & SENTIMENT${tickers ? ` — ${tickers}` : ''}\n${'='.repeat(60)}\n\nARTICLES (${shown.length} of ${feed.length}):\n${items}`)
  } catch (e: any) { return fail(`Alpha Vantage News: ${e?.message ?? String(e)}`) }
}
// Deep-audit fix: Alpha Vantage's free tier is extremely thin (25 requests/day) -- Finnhub's free
// tier is far more generous and includes real-time-ish quotes, so it's the better default choice
// for genuine market-data research; both stay available since either may already be configured.
export async function toolFinnhubQuote(args: any): Promise<ToolResult> { const key = process.env.FINNHUB_API_KEY; if (!key) return needKey('Finnhub', 'FINNHUB_API_KEY', 'https://finnhub.io/register'); const symbol = String(args?.symbol ?? '').trim().toUpperCase(); if (!symbol) return fail('finnhub_quote requires "symbol"'); return getJson(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(key)}`, {}, 'Finnhub Quote') }
export async function toolFREDEconomic(args: any): Promise<ToolResult> { const key = process.env.FRED_API_KEY; if (!key) return needKey('FRED', 'FRED_API_KEY', 'https://fred.stlouisfed.org/docs/api/api_key.html'); const seriesId = String(args?.series_id ?? args?.seriesId ?? '').trim(); if (!seriesId) return fail('fred_economic requires "series_id"'); return getJson(`https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(seriesId)}&api_key=${encodeURIComponent(key)}&file_type=json`, {}, 'FRED') }
export async function toolJinaReader(args: any): Promise<ToolResult> { const url = String(args?.url ?? '').trim(); if (!url) return fail('jina_reader requires "url"'); return getJson(`https://r.jina.ai/${encodeURIComponent(url)}`, { Accept: 'text/plain' }, 'Jina Reader', 15000) }
export async function toolExaSearch(args: any): Promise<ToolResult> {
  const key = process.env.EXA_API_KEY; if (!key) return needKey('Exa', 'EXA_API_KEY', 'https://exa.ai')
  const q = String(args?.query ?? '').trim(); if (!q) return fail('exa_search requires "query"')
  try {
    const response = await fetch('https://api.exa.ai/search', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key }, body: JSON.stringify({ query: q, numResults: Math.min(Math.max(Number(args?.num ?? 5), 1), 20) }), signal: AbortSignal.timeout(10000) })
    if (!response.ok) return fail(`Exa: HTTP ${response.status}`)
    const data = await response.json()
    const results = Array.isArray(data?.results) ? data.results : []
    const items: SearchItem[] = results.filter((r: any) => typeof r?.url === 'string').map((r: any) => ({ title: r.title, url: r.url, snippet: r.text }))
    if (!items.length) return ok('Exa Search', JSON.stringify(data).slice(0, 12000))
    return ok(`Exa Search: ${items.length} real results for "${q.slice(0, 60)}"`, formatSearchItems('Exa Search', q, items))
  } catch (e: any) { return fail(`Exa: ${e?.message ?? String(e)}`) }
}
export async function toolProductHunt(args: any): Promise<ToolResult> { const key = process.env.PRODUCTHUNT_API_KEY; if (!key) return needKey('Product Hunt', 'PRODUCTHUNT_API_KEY', 'https://api.producthunt.com'); const q = String(args?.query ?? '').trim(); if (!q) return fail('producthunt requires "query"'); return fail('Product Hunt API adapter requires a GraphQL query contract; no implicit query is executed.') }
export async function toolHFInference(args: any): Promise<ToolResult> { return toolHuggingFaceLLM(args) }
export async function toolPollinationsImage(args: any): Promise<ToolResult> { const prompt = String(args?.prompt ?? '').trim(); if (!prompt) return fail('pollinations_image requires "prompt"'); return ok('Pollinations image URL', `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}`) }
export async function toolCraiyonImage(args: any): Promise<ToolResult> { const prompt = String(args?.prompt ?? '').trim(); if (!prompt) return fail('craiyon_image requires "prompt"'); return fail('Craiyon image generation is unavailable through the current server-side adapter; use Pollinations or the native image tool.') }
export async function toolStabilityImage(args: any): Promise<ToolResult> { const key = process.env.STABILITY_API_KEY; if (!key) return needKey('Stability AI', 'STABILITY_API_KEY', 'https://platform.stability.ai'); return fail('Stability image adapter is intentionally not invoked until an explicit image request contract is supplied.') }
export async function toolElevenLabsTTS(args: any): Promise<ToolResult> { const key = process.env.ELEVENLABS_API_KEY; if (!key) return needKey('ElevenLabs', 'ELEVENLABS_API_KEY', 'https://elevenlabs.io'); return fail('ElevenLabs TTS adapter is intentionally not invoked without a validated voice contract.') }
export async function toolDeepLTranslate(args: any): Promise<ToolResult> { const key = process.env.DEEPL_API_KEY; if (!key) return needKey('DeepL', 'DEEPL_API_KEY', 'https://www.deepl.com/pro-api'); const text = String(args?.text ?? '').trim(); const target = String(args?.target_lang ?? args?.targetLanguage ?? '').trim(); if (!text || !target) return fail('deepl_translate requires "text" and "target_lang"'); try { const response = await fetch('https://api-free.deepl.com/v2/translate', { method: 'POST', headers: { Authorization: `DeepL-Auth-Key ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ text, target_lang: target.toUpperCase() }), signal: AbortSignal.timeout(10000) }); if (!response.ok) return fail(`DeepL: HTTP ${response.status}`); return ok('DeepL translation', JSON.stringify(await response.json()).slice(0, 8000)) } catch (e: any) { return fail(`DeepL: ${e?.message ?? String(e)}`) } }
export async function toolRemoveBg(args: any): Promise<ToolResult> { const key = process.env.REMOVE_BG_API_KEY; if (!key) return needKey('remove.bg', 'REMOVE_BG_API_KEY', 'https://www.remove.bg/api'); return fail('remove_bg requires a multipart image upload adapter and is not safe to execute with a guessed input contract.') }
export async function toolSummarizeTech(args: any): Promise<ToolResult> { const text = String(args?.text ?? '').trim(); if (!text) return fail('summarize_tech requires "text"'); return ok('Text supplied for summarization', text.slice(0, 12000)) }
export async function toolYahooFinance(args: any): Promise<ToolResult> { const symbol = String(args?.symbol ?? '').trim().toUpperCase(); if (!symbol) return fail('yahoo_finance requires "symbol"'); return getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`, {}, 'Yahoo Finance') }
export async function toolCoinGecko(args: any): Promise<ToolResult> { const action = String(args?.action ?? 'price').trim().toLowerCase(); const coin = String(args?.coin ?? args?.id ?? '').trim().toLowerCase(); if (action === 'trending') return getJson('https://api.coingecko.com/api/v3/search/trending', {}, 'CoinGecko Trending'); if (action === 'list') return getJson('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=20&page=1&sparkline=false', {}, 'CoinGecko List'); if (!coin) return fail('coingecko price requires "coin"'); return getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coin)}&vs_currencies=usd`, {}, 'CoinGecko Price') }
export async function toolTavilyExtract(args: any): Promise<ToolResult> { const url = String(args?.url ?? '').trim(); if (!url) return fail('tavily_extract requires "url"'); const key = process.env.TAVILY_API_KEY; if (!key) return needKey('Tavily Extract', 'TAVILY_API_KEY', 'https://tavily.com'); try { const response = await fetch('https://api.tavily.com/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: key, urls: [url] }), signal: AbortSignal.timeout(15000) }); if (!response.ok) return fail(`Tavily Extract: HTTP ${response.status}`); return ok('Tavily Extract', JSON.stringify(await response.json()).slice(0, 12000)) } catch (e: any) { return fail(`Tavily Extract: ${e?.message ?? String(e)}`) } }

// Dedicated market-data providers -- closes the "OHLCV history + corporate actions" gap the
// existing quote tools (yahoo_finance/finnhub_quote/alpha_vantage) never covered: those all ask
// for a live snapshot (yahoo_finance is hardcoded to range=5d), none return years of daily bars or
// the split/dividend events that silently change what a historical price series means.

export async function toolRoicStockPrices(args: any): Promise<ToolResult> {
  const key = process.env.ROIC_API_KEY
  if (!key) return needKey('ROIC.ai Stock Prices', 'ROIC_API_KEY', 'https://www.roic.ai/api')
  const ticker = String(args?.ticker ?? args?.symbol ?? '').trim().toUpperCase()
  if (!ticker) return fail('roic_stock_prices requires "ticker"')
  const latest = args?.latest === true || args?.latest === 'true'
  const url = latest
    ? `https://api.roic.ai/v2/stock-prices/latest/${encodeURIComponent(ticker)}?apikey=${encodeURIComponent(key)}`
    : `https://api.roic.ai/v2/stock-prices/${encodeURIComponent(ticker)}?apikey=${encodeURIComponent(key)}`
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!response.ok) return fail(`ROIC.ai Stock Prices: HTTP ${response.status}`)
    const data = await response.json()
    const rows = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [data]
    if (!rows.length) return ok(`ROIC.ai Stock Prices: no data for ${ticker}`, JSON.stringify(data).slice(0, 4000))
    const shown = rows.slice(-60)
    const lines = shown.map((r: any) => `  ${r.date ?? r.timestamp ?? '?'}: O=${r.open ?? '-'} H=${r.high ?? '-'} L=${r.low ?? '-'} C=${r.close ?? '-'} AdjC=${r.adjClose ?? r.adjusted_close ?? '-'} V=${r.volume ?? '-'}`).join('\n')
    return ok(`ROIC.ai: ${rows.length} price point(s) for ${ticker}`, `ROIC.AI STOCK PRICES — ${ticker}\n${'='.repeat(60)}\n\n${lines}${rows.length > shown.length ? `\n  ... and ${rows.length - shown.length} more` : ''}`)
  } catch (e: any) { return fail(`ROIC.ai Stock Prices: ${e?.message ?? String(e)}`) }
}

export async function toolRoicFinancials(args: any): Promise<ToolResult> {
  const key = process.env.ROIC_API_KEY
  if (!key) return needKey('ROIC.ai Financials', 'ROIC_API_KEY', 'https://www.roic.ai/api')
  const ticker = String(args?.ticker ?? args?.symbol ?? '').trim().toUpperCase()
  if (!ticker) return fail('roic_financials requires "ticker"')
  const statement = String(args?.statement ?? 'income-statement').trim().toLowerCase()
  const validStatements = new Set(['income-statement', 'balance-sheet', 'cash-flow-statement'])
  if (!validStatements.has(statement)) return fail(`roic_financials "statement" must be one of: ${[...validStatements].join(', ')}`)
  const periodType = String(args?.period_type ?? 'annual').trim().toLowerCase()
  const exchange = String(args?.exchange ?? 'NASDAQ').trim().toUpperCase()
  const identifier = ticker.includes(':') ? ticker : `${exchange}:${ticker}`
  return getJson(`https://api.roic.ai/v3.0.0/fundamental/${statement}/${encodeURIComponent(identifier)}?apikey=${encodeURIComponent(key)}&period_type=${encodeURIComponent(periodType)}`, {}, `ROIC.ai ${statement} — ${identifier}`)
}

export async function toolTiingoDaily(args: any): Promise<ToolResult> {
  const key = process.env.TIINGO_API_KEY
  if (!key) return needKey('Tiingo Daily Prices', 'TIINGO_API_KEY', 'https://www.tiingo.com')
  const ticker = String(args?.ticker ?? args?.symbol ?? '').trim().toUpperCase()
  if (!ticker) return fail('tiingo_daily requires "ticker"')
  const startDate = String(args?.start_date ?? args?.from ?? '').trim()
  const endDate = String(args?.end_date ?? args?.to ?? '').trim()
  const params = new URLSearchParams()
  if (startDate) params.set('startDate', startDate)
  if (endDate) params.set('endDate', endDate)
  const qs = params.toString()
  try {
    const response = await fetch(`https://api.tiingo.com/tiingo/daily/${encodeURIComponent(ticker)}/prices${qs ? `?${qs}` : ''}`, {
      headers: { Authorization: `Token ${key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) return fail(`Tiingo Daily Prices: HTTP ${response.status}`)
    const data = await response.json()
    const rows = Array.isArray(data) ? data : [data]
    if (!rows.length) return ok(`Tiingo: no price data for ${ticker}`, JSON.stringify(data).slice(0, 2000))
    const shown = rows.slice(-60)
    const lines = shown.map((r: any) => `  ${String(r.date ?? '').slice(0, 10)}: O=${r.open} H=${r.high} L=${r.low} C=${r.close} AdjC=${r.adjClose} V=${r.volume} SplitFactor=${r.splitFactor ?? 1} DivCash=${r.divCash ?? 0}`).join('\n')
    return ok(`Tiingo: ${rows.length} daily price point(s) for ${ticker}`, `TIINGO DAILY OHLCV — ${ticker}${startDate || endDate ? ` (${startDate || '...'} to ${endDate || '...'})` : ''}\n${'='.repeat(60)}\n\nAdjusted close and per-day split/dividend factors included (SplitFactor != 1 or DivCash != 0 marks a corporate action that day -- no separate corporate-actions call needed).\n\n${lines}`)
  } catch (e: any) { return fail(`Tiingo Daily Prices: ${e?.message ?? String(e)}`) }
}

// Polygon.io rebranded to Massive.com in Oct 2025 -- existing API keys and the api.polygon.io base
// continue to work under extended support (per Massive's own migration announcement), so
// POLYGON_API_KEY / api.polygon.io are kept rather than forcing a naming change no one asked for.
export async function toolPolygonAggregates(args: any): Promise<ToolResult> {
  const key = process.env.POLYGON_API_KEY
  if (!key) return needKey('Polygon (Massive) Aggregates', 'POLYGON_API_KEY', 'https://massive.com')
  const ticker = String(args?.ticker ?? args?.symbol ?? '').trim().toUpperCase()
  if (!ticker) return fail('polygon_aggregates requires "ticker"')
  const multiplier = Math.max(1, Number(args?.multiplier ?? 1))
  const timespan = String(args?.timespan ?? 'day').trim().toLowerCase()
  const to = String(args?.to ?? new Date().toISOString().slice(0, 10)).trim()
  const from = String(args?.from ?? new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)).trim()
  try {
    const response = await fetch(`https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/${multiplier}/${encodeURIComponent(timespan)}/${encodeURIComponent(from)}/${encodeURIComponent(to)}?adjusted=true&sort=asc&limit=500&apiKey=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(15000) })
    if (!response.ok) return fail(`Polygon Aggregates: HTTP ${response.status}`)
    const data = await response.json()
    const results = Array.isArray(data?.results) ? data.results : []
    if (!results.length) return ok(`Polygon: no bars for ${ticker}`, JSON.stringify(data).slice(0, 2000))
    const shown = results.slice(-60)
    const lines = shown.map((r: any) => `  ${new Date(r.t).toISOString().slice(0, 10)}: O=${r.o} H=${r.h} L=${r.l} C=${r.c} V=${r.v}`).join('\n')
    return ok(`Polygon: ${results.length} bar(s) for ${ticker}`, `POLYGON (MASSIVE) OHLCV — ${ticker} (${multiplier} ${timespan}, ${from} to ${to})\n${'='.repeat(60)}\n\n${lines}`)
  } catch (e: any) { return fail(`Polygon Aggregates: ${e?.message ?? String(e)}`) }
}

export async function toolPolygonCorporateActions(args: any): Promise<ToolResult> {
  const key = process.env.POLYGON_API_KEY
  if (!key) return needKey('Polygon (Massive) Corporate Actions', 'POLYGON_API_KEY', 'https://massive.com')
  const ticker = String(args?.ticker ?? args?.symbol ?? '').trim().toUpperCase()
  if (!ticker) return fail('polygon_corporate_actions requires "ticker"')
  const kind = String(args?.kind ?? 'splits').trim().toLowerCase()
  if (kind !== 'splits' && kind !== 'dividends') return fail('polygon_corporate_actions "kind" must be "splits" or "dividends"')
  try {
    const response = await fetch(`https://api.polygon.io/v3/reference/${kind}?ticker=${encodeURIComponent(ticker)}&limit=50&apiKey=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(15000) })
    if (!response.ok) return fail(`Polygon Corporate Actions: HTTP ${response.status}`)
    const data = await response.json()
    const results = Array.isArray(data?.results) ? data.results : []
    if (!results.length) return ok(`Polygon: no ${kind} found for ${ticker}`, JSON.stringify(data).slice(0, 2000))
    const lines = kind === 'splits'
      ? results.map((r: any) => `  ${r.execution_date}: ${r.split_from}-for-${r.split_to} split`).join('\n')
      : results.map((r: any) => `  Ex-date ${r.ex_dividend_date}: $${r.cash_amount} (pay ${r.pay_date ?? 'n/a'}, freq ${r.frequency ?? 'n/a'})`).join('\n')
    return ok(`Polygon: ${results.length} ${kind} event(s) for ${ticker}`, `POLYGON (MASSIVE) ${kind.toUpperCase()} — ${ticker}\n${'='.repeat(60)}\n\n${lines}`)
  } catch (e: any) { return fail(`Polygon Corporate Actions: ${e?.message ?? String(e)}`) }
}
