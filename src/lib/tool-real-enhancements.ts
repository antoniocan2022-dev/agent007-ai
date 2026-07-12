/**
 * tool-real-enhancements.ts — 7 tools with real free APIs (upgrade #55)
 */
import { ToolResult, ToolContext, okResult, badResult } from './tools'

async function fetchJSON(url: string, timeoutMs = 10000): Promise<any> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'Agent007-AI/5.0', 'Accept': 'application/json' } })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return resp.json()
}

export async function toolRealMarketIntelligence(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const topic = (args?.topic ?? args?.query ?? 'AI').toString()
  try {
    const [hn, reddit, gh] = await Promise.allSettled([
      fetchJSON(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(topic)}&tags=story&hitsPerPage=5`),
      fetchJSON(`https://www.reddit.com/search.json?q=${encodeURIComponent(topic)}&limit=5&sort=hot`),
      fetchJSON(`https://api.github.com/search/repositories?q=${encodeURIComponent(topic)}&sort=stars&per_page=3`),
    ])
    let data = `LIVE MARKET INTELLIGENCE for "${topic}"\n\n`
    if (hn.status==='fulfilled') { const h=hn.value?.hits||[]; data+=`HN (${h.length}):\n${h.map((x:any,i:number)=>`  ${i+1}. ${x.title} (${x.points}pts)`).join('\n')}\n\n` }
    if (reddit.status==='fulfilled') { const p=reddit.value?.data?.children||[]; data+=`REDDIT (${p.length}):\n${p.map((x:any,i:number)=>`  ${i+1}. ${x.data.title} (↑${x.data.score})`).join('\n')}\n\n` }
    if (gh.status==='fulfilled') { const r=gh.value?.items||[]; data+=`GITHUB (${r.length}):\n${r.map((x:any,i:number)=>`  ${i+1}. ${x.full_name} (★${x.stargazers_count})`).join('\n')}` }
    return okResult(`Market Intelligence: LIVE data for "${topic}" ✅`, data)
  } catch (e:any) { return okResult(`Market Intelligence: "${topic}" (APIs unavailable)`, `Error: ${e?.message}`) }
}

export async function toolRealTrendAnalysis(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const topic = (args?.topic ?? 'AI tools').toString()
  try {
    const [hn, reddit] = await Promise.allSettled([
      fetchJSON(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(topic)}&tags=story&hitsPerPage=10&numericFilters=created_at_i>${Math.floor(Date.now()/1000)-604800}`),
      fetchJSON(`https://www.reddit.com/search.json?q=${encodeURIComponent(topic)}&limit=10&sort=hot&t=week`),
    ])
    let mentions=0; let data=`LIVE TREND for "${topic}" (7d)\n\n`
    if (hn.status==='fulfilled') { const h=hn.value?.hits||[]; mentions+=h.length; data+=`HN: ${h.length} stories\n` }
    if (reddit.status==='fulfilled') { const p=reddit.value?.data?.children||[]; mentions+=p.length; data+=`Reddit: ${p.length} posts\n` }
    data+=`\nTrend Score: ${Math.min(100,mentions*5)}/100`
    return okResult(`Trend: "${topic}" score ${Math.min(100,mentions*5)}/100 ✅`, data)
  } catch { return okResult(`Trend: "${topic}" (unavailable)`, 'APIs temporarily unavailable') }
}

export async function toolRealSystemHealth(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const m = process.memoryUsage(); const u = process.uptime()
  return okResult(`System Health: ${(m.heapUsed/1024/1024).toFixed(1)}MB heap, ${Math.round(u)}s uptime ✅`, `Heap: ${(m.heapUsed/1024/1024).toFixed(1)}MB / ${(m.heapTotal/1024/1024).toFixed(1)}MB\nRSS: ${(m.rss/1024/1024).toFixed(1)}MB\nUptime: ${Math.round(u)}s`)
}

export async function toolRealSocialEngagement(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const sub = (args?.subreddit ?? 'artificial').toString()
  try {
    const data = await fetchJSON(`https://www.reddit.com/r/${sub}/hot.json?limit=10`)
    const posts = data?.data?.children || []
    return okResult(`Social: r/${sub} — ${posts.length} posts ✅`, posts.map((p:any,i:number)=>`  ${i+1}. ${p.data?.title?.slice(0,60)} (↑${p.data?.score})`).join('\n'))
  } catch { return okResult(`Social: r/${sub} (unavailable)`, 'API unavailable') }
}

export async function toolRealCryptoAnalyzer(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const coin = (args?.coin ?? 'bitcoin').toString().toLowerCase()
  try {
    const data = await fetchJSON(`https://api.coingecko.com/api/v3/simple/price?ids=${coin}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`)
    const p = data[coin]
    if (p) return okResult(`Crypto: ${coin} = $${p.usd?.toLocaleString()} (${p.usd_24h_change?.toFixed(2)}%) ✅`, `Price: $${p.usd?.toLocaleString()}\n24h: ${p.usd_24h_change?.toFixed(2)}%\nMC: $${p.usd_market_cap?.toLocaleString()}`)
    return badResult('No data for '+coin)
  } catch (e:any) { return badResult(`Crypto: ${e?.message}`) }
}

export async function toolRealStockScreener(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const sym = (args?.symbol ?? 'AAPL').toString().toUpperCase()
  try {
    const resp = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=5d`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) })
    const data = await resp.json(); const r = data?.chart?.result?.[0]; const m = r?.meta
    if (m) { const price=m.regularMarketPrice; const prev=m.previousClose; const chg=price-prev; const pct=(chg/prev*100).toFixed(2)
      return okResult(`Stock: ${sym} = $${price?.toFixed(2)} (${pct}%) ✅`, `Price: $${price?.toFixed(2)}\nChange: ${chg>=0?'+':''}$${chg?.toFixed(2)} (${pct}%)\n52wk: $${m.fiftyTwoWeekLow?.toFixed(2)}-$${m.fiftyTwoWeekHigh?.toFixed(2)}`) }
    return badResult('No data for '+sym)
  } catch (e:any) { return badResult(`Stock: ${e?.message}`) }
}

export async function toolRealUptimeMonitor(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const urls = args?.urls || ['https://agent007-ai.vercel.app', 'https://agent007-ai.vercel.app/api/system/manifest', 'https://api.coingecko.com/api/v3/ping']
  const checks = await Promise.allSettled(urls.map(async (u:string) => { const s=Date.now(); const r=await fetch(u,{signal:AbortSignal.timeout(10000),method:'HEAD'}); return {url:u,status:r.status,latency:Date.now()-s,ok:r.ok} }))
  let ok=0; let data='LIVE UPTIME MONITOR\n\n'
  checks.forEach((c,i) => { if(c.status==='fulfilled'){const v=c.value;data+=`  ${v.ok?'✅':'❌'} ${v.url.slice(0,50)} — HTTP ${v.status} ${v.latency}ms\n`; if(v.ok)ok++} else data+=`  ❌ ${urls[i].slice(0,50)} — TIMEOUT\n` })
  data+=`\n${ok}/${urls.length} UP`
  return okResult(`Uptime: ${ok}/${urls.length} UP ✅`, data)
}
