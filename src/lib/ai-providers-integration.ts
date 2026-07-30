/**
 * ai-providers-integration.ts — 24 NEW AI provider tools.
 * UPGRADE #85 — Full access, no limitations. All auto-locked + FULL_ACCESS.
 *
 * 7 LLM Providers: Cerebras, SambaNova, Together, Mistral, HuggingFace, Cloudflare, Cohere
 * 8 Search/Data: Tavily, SerpAPI, NewsAPI, Alpha Vantage, FRED, Jina Reader, Exa AI, Product Hunt
 * 7 Content/Image: HF Inference, Pollinations, Craiyon, Stability, ElevenLabs, DeepL, Remove.bg
 * 2 Utils: Summarize.tech, Yahoo Finance
 */
import type { ToolResult } from './tools'

function ok(preview: string, result: string): ToolResult { return { ok: true, preview, result } }
function fail(result: string): ToolResult { return { ok: false, preview: result.slice(0, 120), result } }
function needKey(name: string, envVar: string, url: string): ToolResult {
  return fail(`${name} requires ${envVar} env var. Get free key at ${url}. Set on Vercel → Settings → Environment Variables.`)
}

/* ═══ LLM PROVIDERS (7) ═══ */

export async function toolCerebrasLLM(args: any): Promise<ToolResult> {
  const key = process.env.CEREBRAS_API_KEY
  if (!key) return needKey('Cerebras', 'CEREBRAS_API_KEY', 'https://cloud.cerebras.ai')
  const { messages, model = 'llama3.1-8b' } = args ?? {}
  if (!messages) return fail('cerebras_llm requires "messages" array')
  try {
    const res = await fetch('https://api.cerebras.ai/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 8000 }),
      signal: AbortSignal.timeout(60000),
    })
    if (!res.ok) return fail(`Cerebras: HTTP ${res.status}`)
    const data = await res.json()
    return ok(data.choices?.[0]?.message?.content?.slice(0, 80) ?? 'ok', `Cerebras (${model}):\n${data.choices?.[0]?.message?.content ?? ''}`)
  } catch (e: any) { return fail(`Cerebras: ${e?.message}`) }
}

export async function toolSambaNovaLLM(args: any): Promise<ToolResult> {
  const key = process.env.SAMBANOVA_API_KEY
  if (!key) return needKey('SambaNova', 'SAMBANOVA_API_KEY', 'https://sambanova.ai')
  const { messages, model = 'Meta-Llama-3.1-405B-Instruct' } = args ?? {}
  if (!messages) return fail('sambanova_llm requires "messages" array')
  try {
    const res = await fetch('https://api.sambanova.ai/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 8000 }),
      signal: AbortSignal.timeout(60000),
    })
    if (!res.ok) return fail(`SambaNova: HTTP ${res.status}`)
    const data = await res.json()
    return ok(data.choices?.[0]?.message?.content?.slice(0, 80) ?? 'ok', `SambaNova (${model}):\n${data.choices?.[0]?.message?.content ?? ''}`)
  } catch (e: any) { return fail(`SambaNova: ${e?.message}`) }
}

export async function toolTogetherLLM(args: any): Promise<ToolResult> {
  const key = process.env.TOGETHER_API_KEY
  if (!key) return needKey('Together AI', 'TOGETHER_API_KEY', 'https://api.together.xyz')
  const { messages, model = 'meta-llama/Llama-3.3-70B-Instruct-Turbo' } = args ?? {}
  if (!messages) return fail('together_llm requires "messages" array')
  try {
    const res = await fetch('https://api.together.xyz/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 8000 }),
      signal: AbortSignal.timeout(60000),
    })
    if (!res.ok) return fail(`Together AI: HTTP ${res.status}`)
    const data = await res.json()
    return ok(data.choices?.[0]?.message?.content?.slice(0, 80) ?? 'ok', `Together AI (${model}):\n${data.choices?.[0]?.message?.content ?? ''}`)
  } catch (e: any) { return fail(`Together AI: ${e?.message}`) }
}

export async function toolMistralLLM(args: any): Promise<ToolResult> {
  const key = process.env.MISTRAL_API_KEY
  if (!key) return needKey('Mistral AI', 'MISTRAL_API_KEY', 'https://console.mistral.ai')
  const { messages, model = 'mistral-large-latest' } = args ?? {}
  if (!messages) return fail('mistral_llm requires "messages" array')
  try {
    const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 8000 }),
      signal: AbortSignal.timeout(60000),
    })
    if (!res.ok) return fail(`Mistral: HTTP ${res.status}`)
    const data = await res.json()
    return ok(data.choices?.[0]?.message?.content?.slice(0, 80) ?? 'ok', `Mistral (${model}):\n${data.choices?.[0]?.message?.content ?? ''}`)
  } catch (e: any) { return fail(`Mistral: ${e?.message}`) }
}

export async function toolHuggingFaceLLM(args: any): Promise<ToolResult> {
  const key = process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY
  if (!key) return needKey('Hugging Face', 'HUGGINGFACE_API_KEY', 'https://huggingface.co/settings/tokens')
  const { messages, model = 'meta-llama/Llama-3.3-70B-Instruct' } = args ?? {}
  if (!messages) return fail('hf_llm requires "messages" array')
  try {
    const res = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ inputs: messages.map((m: any) => `${m.role}: ${m.content}`).join('\n'), parameters: { temperature: 0.3, max_new_tokens: 8000 } }),
      signal: AbortSignal.timeout(60000),
    })
    if (!res.ok) return fail(`HuggingFace: HTTP ${res.status}`)
    const data = await res.json()
    const content = Array.isArray(data) ? data[0]?.generated_text ?? '' : data?.generated_text ?? ''
    return ok(content.slice(0, 80) || 'ok', `HuggingFace (${model}):\n${content}`)
  } catch (e: any) { return fail(`HuggingFace: ${e?.message}`) }
}

export async function toolCloudflareLLM(args: any): Promise<ToolResult> {
  const key = process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN
  const accountId = process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID
  if (!key) return needKey('Cloudflare Workers AI', 'CLOUDFLARE_API_TOKEN', 'https://dash.cloudflare.com')
  const { messages, model = '@cf/meta/llama-3.1-8b-instruct' } = args ?? {}
  if (!messages) return fail('cloudflare_llm requires "messages" array')
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ messages }),
      signal: AbortSignal.timeout(60000),
    })
    if (!res.ok) return fail(`Cloudflare: HTTP ${res.status}`)
    const data = await res.json()
    return ok(data?.result?.response?.slice(0, 80) ?? 'ok', `Cloudflare (${model}):\n${data?.result?.response ?? ''}`)
  } catch (e: any) { return fail(`Cloudflare: ${e?.message}`) }
}

export async function toolCohereLLM(args: any): Promise<ToolResult> {
  const key = process.env.COHERE_API_KEY
  if (!key) return needKey('Cohere', 'COHERE_API_KEY', 'https://dashboard.cohere.com')
  const { messages, model = 'command-r-plus' } = args ?? {}
  if (!messages) return fail('cohere_llm requires "messages" array')
  try {
    const res = await fetch('https://api.cohere.ai/v1/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, message: messages[messages.length - 1]?.content ?? '', chat_history: messages.slice(0, -1).map((m: any) => ({ role: m.role === 'assistant' ? 'CHATBOT' : 'USER', message: m.content })) }),
      signal: AbortSignal.timeout(60000),
    })
    if (!res.ok) return fail(`Cohere: HTTP ${res.status}`)
    const data = await res.json()
    return ok(data?.text?.slice(0, 80) ?? 'ok', `Cohere (${model}):\n${data?.text ?? ''}`)
  } catch (e: any) { return fail(`Cohere: ${e?.message}`) }
}

/* ═══ SEARCH & DATA PROVIDERS (8) ═══ */

export async function toolTavilySearch(args: any): Promise<ToolResult> {
  const key = process.env.TAVILY_API_KEY
  if (!key) return needKey('Tavily', 'TAVILY_API_KEY', 'https://tavily.com')
  const { query, max_results = 5 } = args ?? {}
  if (!query) return fail('tavily_search requires "query"')
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key, query, max_results, include_answer: true }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) return fail(`Tavily: HTTP ${res.status}`)
    const data = await res.json()
    const answer = data?.answer ?? ''
    const results = (data?.results ?? []).map((r: any) => `  ${r.title}: ${r.url}\n  ${r.content?.slice(0, 200) ?? ''}`).join('\n\n')
    return ok(`${(data?.results ?? []).length} results + AI answer`, `Tavily AI Search: "${query}"\n\nAI Answer: ${answer}\n\nResults:\n${results}`)
  } catch (e: any) { return fail(`Tavily: ${e?.message}`) }
}

export async function toolSerpAPI(args: any): Promise<ToolResult> {
  const key = process.env.SERPAPI_API_KEY
  if (!key) return needKey('SerpAPI', 'SERPAPI_API_KEY', 'https://serpapi.com')
  const { query, engine = 'google' } = args ?? {}
  if (!query) return fail('serpapi requires "query"')
  try {
    const res = await fetch(`https://serpapi.com/search?engine=${engine}&q=${encodeURIComponent(query)}&api_key=${key}`, { signal: AbortSignal.timeout(30000) })
    if (!res.ok) return fail(`SerpAPI: HTTP ${res.status}`)
    const data = await res.json()
    const results = (data?.organic_results ?? []).slice(0, 5).map((r: any) => `  ${r.title}: ${r.link}`).join('\n')
    return ok(`${(data?.organic_results ?? []).length} results`, `SerpAPI (${engine}): "${query}"\n${results}`)
  } catch (e: any) { return fail(`SerpAPI: ${e?.message}`) }
}

export async function toolNewsAPI(args: any): Promise<ToolResult> {
  const key = process.env.NEWSAPI_KEY || process.env.NEWSAPI_API_KEY
  if (!key) return needKey('NewsAPI', 'NEWSAPI_API_KEY', 'https://newsapi.org')
  const { query, category, language = 'en', page_size = 5 } = args ?? {}
  try {
    const params = new URLSearchParams({ apiKey: key, language, pageSize: String(page_size) })
    if (query) params.set('q', query)
    if (category) params.set('category', category)
    const endpoint = query ? 'everything' : 'top-headlines'
    const res = await fetch(`https://newsapi.org/v2/${endpoint}?${params}`, { signal: AbortSignal.timeout(30000) })
    if (!res.ok) return fail(`NewsAPI: HTTP ${res.status}`)
    const data = await res.json()
    const results = (data?.articles ?? []).map((a: any) => `  ${a.title}\n  ${a.url}\n  ${a.description?.slice(0, 150) ?? ''}`).join('\n\n')
    return ok(`${data?.articles?.length ?? 0} articles`, `NewsAPI:\n${results}`)
  } catch (e: any) { return fail(`NewsAPI: ${e?.message}`) }
}

export async function toolAlphaVantage(args: any): Promise<ToolResult> {
  const key = process.env.ALPHA_VANTAGE_KEY || process.env.ALPHAVANTAGE_API_KEY
  if (!key) return needKey('Alpha Vantage', 'ALPHAVANTAGE_API_KEY', 'https://alphavantage.co')
  const { symbol, function: fn = 'GLOBAL_QUOTE' } = args ?? {}
  if (!symbol) return fail('alpha_vantage requires "symbol"')
  try {
    const res = await fetch(`https://www.alphavantage.co/query?function=${fn}&symbol=${symbol}&apikey=${key}`, { signal: AbortSignal.timeout(30000) })
    if (!res.ok) return fail(`Alpha Vantage: HTTP ${res.status}`)
    const data = await res.json()
    return ok(`${symbol} data retrieved`, `Alpha Vantage (${fn} ${symbol}):\n${JSON.stringify(data, null, 2).slice(0, 500)}`)
  } catch (e: any) { return fail(`Alpha Vantage: ${e?.message}`) }
}

export async function toolFREDEconomic(args: any): Promise<ToolResult> {
  const key = process.env.FRED_API_KEY || 'your-fred-api-key'
  const { series_id = 'GDP', observation_start, observation_end } = args ?? {}
  try {
    const params = new URLSearchParams({ api_key: key, file_type: 'json' })
    if (observation_start) params.set('observation_start', observation_start)
    if (observation_end) params.set('observation_end', observation_end)
    const res = await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=${series_id}&${params}`, { signal: AbortSignal.timeout(30000) })
    if (!res.ok) return fail(`FRED: HTTP ${res.status}`)
    const data = await res.json()
    const observations = data?.observations ?? []
    const recent = observations.slice(-5).map((o: any) => `  ${o.date}: ${o.value}`).join('\n')
    return ok(`${observations.length} data points`, `FRED Economic Data (${series_id}):\n${recent}`)
  } catch (e: any) { return fail(`FRED: ${e?.message}`) }
}

export async function toolJinaReader(args: any): Promise<ToolResult> {
  const { url } = args ?? {}
  if (!url) return fail('jina_reader requires "url"')
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, { headers: { 'Accept': 'text/markdown' }, signal: AbortSignal.timeout(30000) })
    if (!res.ok) return fail(`Jina Reader: HTTP ${res.status}`)
    const text = await res.text()
    return ok(`${text.length} chars from ${url}`, `Jina AI Reader (${url}):\n${text.slice(0, 2000)}`)
  } catch (e: any) { return fail(`Jina Reader: ${e?.message}`) }
}

export async function toolExaSearch(args: any): Promise<ToolResult> {
  const key = process.env.EXA_API_KEY
  if (!key) return needKey('Exa AI', 'EXA_API_KEY', 'https://exa.ai')
  const { query, num_results = 5 } = args ?? {}
  if (!query) return fail('exa_search requires "query"')
  try {
    const res = await fetch('https://api.exa.ai/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({ query, num_results, type: 'neural' }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) return fail(`Exa: HTTP ${res.status}`)
    const data = await res.json()
    const results = (data?.results ?? []).map((r: any) => `  ${r.title}: ${r.url}`).join('\n')
    return ok(`${data?.results?.length ?? 0} results`, `Exa AI Search: "${query}"\n${results}`)
  } catch (e: any) { return fail(`Exa: ${e?.message}`) }
}

export async function toolProductHunt(args: any): Promise<ToolResult> {
  const key = process.env.PH_API_KEY || process.env.PRODUCTHUNT_API_TOKEN
  if (!key) return needKey('Product Hunt', 'PRODUCTHUNT_API_TOKEN', 'https://api.producthunt.com/v2/docs')
  const { action = 'trending' } = args ?? {}
  try {
    const res = await fetch('https://api.producthunt.com/v2/api/graphql', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query: '{ posts(first: 5, order: VOTES) { edges { node { name tagline url votesCount } } } }' }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) return fail(`Product Hunt: HTTP ${res.status}`)
    const data = await res.json()
    const posts = data?.data?.posts?.edges ?? []
    const results = posts.map((e: any) => `  ${e.node.name}: ${e.node.tagline} (${e.node.votesCount} votes)`).join('\n')
    return ok(`${posts.length} products`, `Product Hunt Trending:\n${results}`)
  } catch (e: any) { return fail(`Product Hunt: ${e?.message}`) }
}

/* ═══ CONTENT & IMAGE PROVIDERS (7) ═══ */

export async function toolHFInference(args: any): Promise<ToolResult> {
  const key = process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY
  if (!key) return needKey('Hugging Face Inference', 'HUGGINGFACE_API_KEY', 'https://huggingface.co/settings/tokens')
  const { model = 'facebook/bart-large-cnn', inputs, parameters } = args ?? {}
  if (!inputs) return fail('hf_inference requires "inputs"')
  try {
    const res = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ inputs, parameters }),
      signal: AbortSignal.timeout(60000),
    })
    if (!res.ok) return fail(`HF Inference: HTTP ${res.status}`)
    const data = await res.json()
    return ok(`HF ${model} done`, `HuggingFace Inference (${model}):\n${JSON.stringify(data).slice(0, 1000)}`)
  } catch (e: any) { return fail(`HF Inference: ${e?.message}`) }
}

export async function toolPollinationsImage(args: any): Promise<ToolResult> {
  const { prompt, width = 1024, height = 1024, seed } = args ?? {}
  if (!prompt) return fail('pollinations_image requires "prompt"')
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}${seed ? `&seed=${seed}` : ''}`
  return ok(`Image generated: ${prompt.slice(0, 50)}`, `Pollinations AI Image:\nPrompt: ${prompt}\nURL: ${url}\n\nThe image is available at the URL above. Use it directly in img tags or download it.`)
}

export async function toolCraiyonImage(args: any): Promise<ToolResult> {
  const { prompt } = args ?? {}
  if (!prompt) return fail('craiyon_image requires "prompt"')
  try {
    const res = await fetch('https://api.craiyon.com/v3', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
      signal: AbortSignal.timeout(60000),
    })
    if (!res.ok) return fail(`Craiyon: HTTP ${res.status}`)
    const data = await res.json()
    const images = data?.images ?? []
    return ok(`${images.length} images generated`, `Craiyon Image:\nPrompt: ${prompt}\nImages: ${images.slice(0, 3).map((img: string) => `https://img.craiyon.com/${img}`).join('\n')}`)
  } catch (e: any) { return fail(`Craiyon: ${e?.message}`) }
}

export async function toolStabilityImage(args: any): Promise<ToolResult> {
  const key = process.env.STABILITY_API_KEY
  if (!key) return needKey('Stability AI', 'STABILITY_API_KEY', 'https://platform.stability.ai')
  const { prompt, negative_prompt, width = 1024, height = 1024 } = args ?? {}
  if (!prompt) return fail('stability_image requires "prompt"')
  try {
    const res = await fetch('https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, Accept: 'application/json' },
      body: JSON.stringify({ text_prompts: [{ text: prompt, weight: 1 }, ...(negative_prompt ? [{ text: negative_prompt, weight: -1 }] : [])], cfg_scale: 7, width, height, samples: 1, steps: 30 }),
      signal: AbortSignal.timeout(120000),
    })
    if (!res.ok) return fail(`Stability: HTTP ${res.status}`)
    const data = await res.json()
    return ok('Image generated', `Stability AI Image:\nPrompt: ${prompt}\nImage base64 length: ${data?.artifacts?.[0]?.base64?.length ?? 0} chars`)
  } catch (e: any) { return fail(`Stability: ${e?.message}`) }
}

export async function toolElevenLabsTTS(args: any): Promise<ToolResult> {
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) return needKey('ElevenLabs', 'ELEVENLABS_API_KEY', 'https://elevenlabs.io')
  const { text, voice_id = '21m00Tcm4TlvDq8ikWAM', model_id = 'eleven_multilingual_v2' } = args ?? {}
  if (!text) return fail('elevenlabs_tts requires "text"')
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice_id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'xi-api-key': key, Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id, voice_settings: { stability: 0.5, similarity_boost: 0.5 } }),
      signal: AbortSignal.timeout(60000),
    })
    if (!res.ok) return fail(`ElevenLabs: HTTP ${res.status}`)
    return ok(`Audio generated (${text.length} chars)`, `ElevenLabs TTS:\nText: ${text.slice(0, 100)}\nVoice: ${voice_id}\nAudio generated successfully (${res.headers.get('content-length') ?? '?'} bytes)`)
  } catch (e: any) { return fail(`ElevenLabs: ${e?.message}`) }
}

export async function toolDeepLTranslate(args: any): Promise<ToolResult> {
  const key = process.env.DEEPL_API_KEY
  if (!key) return needKey('DeepL', 'DEEPL_API_KEY', 'https://deepl.com/pro-api')
  const { text, target_lang = 'EN', source_lang } = args ?? {}
  if (!text) return fail('deepl_translate requires "text"')
  try {
    const params = new URLSearchParams({ auth_key: key, text, target_lang })
    if (source_lang) params.set('source_lang', source_lang)
    const res = await fetch(`https://api-free.deepl.com/v2/translate?${params}`, { signal: AbortSignal.timeout(30000) })
    if (!res.ok) return fail(`DeepL: HTTP ${res.status}`)
    const data = await res.json()
    const translation = data?.translations?.[0]?.text ?? ''
    return ok(`Translated to ${target_lang}`, `DeepL Translation:\nOriginal: ${text.slice(0, 100)}\nTranslated (${target_lang}): ${translation}`)
  } catch (e: any) { return fail(`DeepL: ${e?.message}`) }
}

export async function toolRemoveBg(args: any): Promise<ToolResult> {
  const key = process.env.REMOVEBG_API_KEY
  if (!key) return needKey('Remove.bg', 'REMOVEBG_API_KEY', 'https://remove.bg/api')
  const { image_url } = args ?? {}
  if (!image_url) return fail('remove_bg requires "image_url"')
  try {
    const res = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST', headers: { 'X-Api-Key': key },
      body: JSON.stringify({ image_url, size: 'auto' }),
      signal: AbortSignal.timeout(60000),
    })
    if (!res.ok) return fail(`Remove.bg: HTTP ${res.status}`)
    return ok('Background removed', `Remove.bg:\nImage: ${image_url}\nBackground removed successfully. Result available as binary response.`)
  } catch (e: any) { return fail(`Remove.bg: ${e?.message}`) }
}

/* ═══ UTILITIES (2) ═══ */

export async function toolSummarizeTech(args: any): Promise<ToolResult> {
  const { url } = args ?? {}
  if (!url) return fail('summarize_tech requires "url" (YouTube/video URL)')
  try {
    const res = await fetch(`https://summarize.tech/api/v1/summarize?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(30000) })
    if (!res.ok) return fail(`Summarize.tech: HTTP ${res.status}`)
    const data = await res.json()
    return ok('Video summarized', `Summarize.tech:\nURL: ${url}\nSummary: ${JSON.stringify(data).slice(0, 1000)}`)
  } catch (e: any) { return fail(`Summarize.tech: ${e?.message}`) }
}

export async function toolYahooFinance(args: any): Promise<ToolResult> {
  const key = process.env.RAPIDAPI_KEY
  if (!key) return needKey('Yahoo Finance (RapidAPI)', 'RAPIDAPI_KEY', 'https://rapidapi.com')
  const { symbol, action = 'get-quote' } = args ?? {}
  if (!symbol) return fail('yahoo_finance requires "symbol"')

  // UPGRADE #181 fix #2: Try multiple RapidAPI Yahoo Finance endpoints.
  // The old endpoint (apidojo-yahoo-finance-v1) returns HTTP 403 on some
  // RapidAPI keys. Try 3 alternatives before giving up.
  const endpoints = [
    {
      host: 'apidojo-yahoo-finance-v1.p.rapidapi.com',
      url: `https://apidojo-yahoo-finance-v1.p.rapidapi.com/stock/v2/get-summary?symbol=${symbol}`,
    },
    {
      host: 'yahoo-finance127.p.rapidapi.com',
      url: `https://yahoo-finance127.p.rapidapi.com/price/${symbol}`,
    },
    {
      host: 'yahoo-finance15.p.rapidapi.com',
      url: `https://yahoo-finance15.p.rapidapi.com/api/v1/markets/quote?ticker=${symbol}`,
    },
  ]

  for (const ep of endpoints) {
    try {
      const res = await fetch(ep.url, {
        headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': ep.host },
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) {
        console.warn(`[yahoo_finance] ${ep.host}: HTTP ${res.status}, trying next...`)
        continue
      }
      const data = await res.json()

      // Parse price from various response formats
      const price = data?.price?.regularMarketPrice?.raw
        ?? data?.price?.regularMarketPrice
        ?? data?.regularMarketPrice
        ?? data?.quoteSummary?.result?.[0]?.price?.regularMarketPrice?.raw
        ?? data?.body?.[0]?.regularMarketPrice
        ?? 'N/A'
      const change = data?.price?.regularMarketChangePercent?.raw
        ?? data?.price?.regularMarketChangePercent
        ?? data?.regularMarketChangePercent
        ?? data?.body?.[0]?.regularMarketChangePercent
        ?? 'N/A'
      const currency = data?.summaryDetail?.currency
        ?? data?.price?.currency
        ?? data?.body?.[0]?.currency
        ?? 'USD'
      const name = data?.price?.longName
        ?? data?.quoteSummary?.result?.[0]?.price?.longName
        ?? data?.body?.[0]?.longName
        ?? symbol

      if (price !== 'N/A') {
        return ok(
          `${symbol}: $${price} (${change}%)`,
          `Yahoo Finance (${symbol}) via ${ep.host}:\n` +
          `Name: ${name}\n` +
          `Price: $${price}\n` +
          `Change: ${change}%\n` +
          `Currency: ${currency}\n\n` +
          `Source: RapidAPI (${ep.host})`
        )
      }
    } catch (e: any) {
      console.warn(`[yahoo_finance] ${ep.host} error: ${e?.message?.slice(0, 80)}`)
    }
  }

  return fail(`Yahoo Finance: All ${endpoints.length} RapidAPI endpoints failed for "${symbol}". The RAPIDAPI_KEY may be invalid or the free tier expired. Try CoinGecko for crypto (no API key needed) or alpha_vantage for stocks.`)
}

// UPGRADE #181 fix #2b: CoinGecko — free crypto data, NO API key needed.
// Works on Vercel production. QUANTUM uses this alongside yahoo_finance
// to cross-verify crypto prices.
export async function toolCoinGecko(args: any): Promise<ToolResult> {
  const { coin, action = 'price' } = args ?? {}
  if (!coin) return fail('coingecko requires "coin" (e.g. "bitcoin", "ethereum", "solana")')

  try {
    if (action === 'price' || !action) {
      // Get current price + 24h change
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coin)}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) return fail(`CoinGecko: HTTP ${res.status}`)
      const data = await res.json()
      const coinData = data?.[coin]
      if (!coinData) return fail(`CoinGecko: coin "${coin}" not found. Use lowercase ID (e.g. "bitcoin", "ethereum", "solana", "cardano")`)

      const price = coinData.usd
      const change24h = coinData.usd_24h_change
      const marketCap = coinData.usd_market_cap
      const volume24h = coinData.usd_24h_vol

      return ok(
        `${coin}: $${price} (${change24h?.toFixed(2)}%)`,
        `CoinGecko (${coin}):\n` +
        `Price: $${price?.toLocaleString()}\n` +
        `24h Change: ${change24h?.toFixed(2)}%\n` +
        `Market Cap: $${marketCap?.toLocaleString()}\n` +
        `24h Volume: $${volume24h?.toLocaleString()}\n\n` +
        `Source: CoinGecko API (free, no key needed)\n` +
        `Compare with yahoo_finance for cross-verification.`
      )
    } else if (action === 'trending') {
      // Get trending coins
      const res = await fetch('https://api.coingecko.com/api/v3/search/trending', {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) return fail(`CoinGecko trending: HTTP ${res.status}`)
      const data = await res.json()
      const trending = (data?.coins ?? []).slice(0, 10).map((c: any, i: number) =>
        `${i + 1}. ${c.item.name} (${c.item.symbol}) — Rank #${c.item.market_cap_rank ?? 'N/A'} — ID: ${c.item.id}`
      ).join('\n')
      return ok(
        `Trending: ${Math.min(10, data?.coins?.length ?? 0)} coins`,
        `CoinGecko Trending Coins:\n\n${trending}\n\nSource: CoinGecko API (free)`
      )
    } else if (action === 'list') {
      // List top coins by market cap
      const res = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=20&page=1', {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) return fail(`CoinGecko list: HTTP ${res.status}`)
      const data = await res.json()
      const coins = (Array.isArray(data) ? data : []).slice(0, 20).map((c: any, i: number) =>
        `${i + 1}. ${c.name} (${c.symbol?.toUpperCase()}) — $${c.current_price} (${c.price_change_percentage_24h?.toFixed(2)}%) — MCap: $${(c.market_cap / 1e9).toFixed(2)}B`
      ).join('\n')
      return ok(
        `Top 20 coins by market cap`,
        `CoinGecko Top 20:\n\n${coins}\n\nSource: CoinGecko API (free)`
      )
    }
    return fail(`CoinGecko: unknown action "${action}". Use "price", "trending", or "list".`)
  } catch (e: any) {
    return fail(`CoinGecko: ${e?.message}`)
  }
}
