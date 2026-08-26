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
export async function toolTavilySearch(args: any): Promise<ToolResult> { const key = process.env.TAVILY_API_KEY; if (!key) return needKey('Tavily Search', 'TAVILY_API_KEY', 'https://tavily.com'); const query = String(args?.query ?? '').trim(); if (!query) return fail('tavily_search requires "query"'); try { const response = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: key, query, max_results: Math.min(Math.max(Number(args?.num ?? 5), 1), 10) }), signal: AbortSignal.timeout(10000) }); if (!response.ok) return fail(`Tavily: HTTP ${response.status}`); const data = await response.json(); return ok('Tavily Search', JSON.stringify(data).slice(0, 12000)) } catch (e: any) { return fail(`Tavily: ${e?.message ?? String(e)}`) } }
export async function toolSerpAPI(args: any): Promise<ToolResult> { const key = process.env.SERPAPI_API_KEY; if (!key) return needKey('SerpAPI', 'SERPAPI_API_KEY', 'https://serpapi.com'); const q = String(args?.query ?? '').trim(); if (!q) return fail('serpapi_search requires "query"'); return getJson(`https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(q)}&api_key=${encodeURIComponent(key)}`, {}, 'SerpAPI') }
export async function toolNewsAPI(args: any): Promise<ToolResult> { const key = process.env.NEWSAPI_KEY || process.env.NEWS_API_KEY; if (!key) return needKey('NewsAPI', 'NEWSAPI_KEY', 'https://newsapi.org'); const q = String(args?.query ?? '').trim(); if (!q) return fail('newsapi_search requires "query"'); return getJson(`https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&pageSize=10&apiKey=${encodeURIComponent(key)}`, {}, 'NewsAPI') }
export async function toolAlphaVantage(args: any): Promise<ToolResult> { const key = process.env.ALPHA_VANTAGE_API_KEY; if (!key) return needKey('Alpha Vantage', 'ALPHA_VANTAGE_API_KEY', 'https://www.alphavantage.co'); const symbol = String(args?.symbol ?? '').trim(); if (!symbol) return fail('alpha_vantage requires "symbol"'); return getJson(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`, {}, 'Alpha Vantage') }
export async function toolFREDEconomic(args: any): Promise<ToolResult> { const key = process.env.FRED_API_KEY; if (!key) return needKey('FRED', 'FRED_API_KEY', 'https://fred.stlouisfed.org/docs/api/api_key.html'); const seriesId = String(args?.series_id ?? args?.seriesId ?? '').trim(); if (!seriesId) return fail('fred_economic requires "series_id"'); return getJson(`https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(seriesId)}&api_key=${encodeURIComponent(key)}&file_type=json`, {}, 'FRED') }
export async function toolJinaReader(args: any): Promise<ToolResult> { const url = String(args?.url ?? '').trim(); if (!url) return fail('jina_reader requires "url"'); return getJson(`https://r.jina.ai/${encodeURIComponent(url)}`, { Accept: 'text/plain' }, 'Jina Reader', 15000) }
export async function toolExaSearch(args: any): Promise<ToolResult> { const key = process.env.EXA_API_KEY; if (!key) return needKey('Exa', 'EXA_API_KEY', 'https://exa.ai'); const q = String(args?.query ?? '').trim(); if (!q) return fail('exa_search requires "query"'); try { const response = await fetch('https://api.exa.ai/search', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key }, body: JSON.stringify({ query: q, numResults: Math.min(Math.max(Number(args?.num ?? 5), 1), 20) }), signal: AbortSignal.timeout(10000) }); if (!response.ok) return fail(`Exa: HTTP ${response.status}`); return ok('Exa Search', JSON.stringify(await response.json()).slice(0, 12000)) } catch (e: any) { return fail(`Exa: ${e?.message ?? String(e)}`) } }
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
