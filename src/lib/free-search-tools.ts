/**
 * free-search-tools.ts — 15 free AI search platform tools.
 *
 * Each tool queries a REAL free API (no API key required) and returns
 * results. All tools work on Vercel serverless.
 *
 * Platforms:
 *   1. DuckDuckGo Instant Answer API
 *   2. Brave Search (free tier, no key needed for basic)
 *   3. Wikipedia REST API
 *   4. arXiv (academic papers)
 *   5. HackerNews (Algolia API)
 *   6. Reddit JSON API
 *   7. GitHub Search API
 *   8. Stack Overflow API
 *   9. OpenAlex (academic research)
 *  10. Semantic Scholar API
 *  11. CORE API (open access research)
 *  12. Product Hunt (public API)
 *  13. PubMed (NCBI E-utilities)
 *  14. SearXNG public instances
 *  15. Google Scholar (scraping fallback)
 */

import { ToolResult, ToolContext, okResult, badResult } from './tools'

const TIMEOUT_MS = 10000
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Agent007-AI/1.0'

async function safeFetch(url: string, opts: any = {}): Promise<{ ok: boolean; status: number; data: any; text: string }> {
  try {
    const res = await fetch(url, {
      ...opts,
      signal: AbortSignal.timeout(opts.timeout ?? TIMEOUT_MS),
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json', ...(opts.headers ?? {}) },
    })
    const text = await res.text().catch(() => '')
    let data: any = null
    try { data = JSON.parse(text) } catch {}
    return { ok: res.ok, status: res.status, data, text }
  } catch (e: any) {
    return { ok: false, status: 0, data: null, text: e?.message ?? 'fetch failed' }
  }
}

/* 1. DuckDuckGo */
export async function toolDuckDuckGoSearch(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const query = (args?.query ?? '').toString().trim()
  if (!query) return badResult('Missing "query"')
  const r = await safeFetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`)
  if (!r.data) return badResult(`DuckDuckGo failed: ${r.text}`)
  const results: any[] = []
  if (r.data.AbstractText) results.push({ title: r.data.Heading, url: r.data.AbstractURL, snippet: r.data.AbstractText })
  if (Array.isArray(r.data.RelatedTopics)) for (const t of r.data.RelatedTopics.slice(0, 8)) if (t.Text) results.push({ title: t.Text.slice(0, 80), url: t.FirstURL, snippet: t.Text })
  if (r.data.Answer) results.push({ title: 'Answer', url: '', snippet: r.data.Answer })
  const formatted = results.map((r, i) => `${i+1}. ${r.title}\n   ${r.url}\n   ${r.snippet?.slice(0,300)}`).join('\n\n')
  return okResult(`DuckDuckGo: ${results.length} results for "${query}"`, `DUCKDUCKGO SEARCH: "${query}"\n\n${formatted || 'No results.'}`)
}

/* 2. Brave Search */
export async function toolBraveSearch(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const query = (args?.query ?? '').toString().trim()
  if (!query) return badResult('Missing "query"')
  const apiKey = process.env.BRAVE_API_KEY
  if (apiKey) {
    const r = await safeFetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`, { headers: { 'X-Subscription-Token': apiKey } })
    if (r.ok && r.data?.web?.results) {
      const results = r.data.web.results.slice(0, 5).map((r: any, i: number) => `${i+1}. ${r.title}\n   ${r.url}\n   ${r.description?.slice(0,300)}`).join('\n\n')
      return okResult(`Brave: 5 results`, `BRAVE SEARCH: "${query}"\n\n${results}`)
    }
  }
  // Fallback: scrape Brave search page
  const r = await safeFetch(`https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`, { headers: { 'Accept': 'text/html' } })
  const titles: string[] = []; const urls: string[] = []
  const titleRe = /<a[^>]*class="result-header"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/g
  let m; while ((m = titleRe.exec(r.text)) !== null) titles.push(m[1].trim())
  const urlRe = /href="(https?:[^"]+)"/g
  while ((m = urlRe.exec(r.text)) !== null) if (!m[1].includes('brave.com')) urls.push(m[1])
  const results = titles.slice(0,5).map((t,i) => `${i+1}. ${t}\n   ${urls[i] || ''}`).join('\n\n')
  return okResult(`Brave (scraped): ${titles.length} results`, `BRAVE SEARCH: "${query}"\n\n${results || 'No results.'}`)
}

/* 3. Wikipedia REST */
export async function toolWikipediaRestSearch(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const query = (args?.query ?? '').toString().trim()
  if (!query) return badResult('Missing "query"')
  const r = await safeFetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query.replace(/\s+/g, '_'))}`)
  if (r.ok && r.data?.extract) {
    return okResult(`Wikipedia: ${r.data.title}`, `WIKIPEDIA: ${r.data.title}\nURL: ${r.data.content_urls?.desktop?.page}\n\n${r.data.extract}`)
  }
  // Fallback to search
  const sr = await safeFetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=5`)
  if (sr.data?.query?.search) {
    const results = sr.data.query.search.map((r: any, i: number) => `${i+1}. ${r.title}\n   https://en.wikipedia.org/wiki/${r.title.replace(/\s/g,'_')}\n   ${r.snippet?.replace(/<[^>]+>/g,'').slice(0,300)}`).join('\n\n')
    return okResult(`Wikipedia search: 5 results`, `WIKIPEDIA SEARCH: "${query}"\n\n${results}`)
  }
  return badResult('Wikipedia: no results')
}

/* 4. arXiv */
export async function toolArxivSearch(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const query = (args?.query ?? '').toString().trim()
  if (!query) return badResult('Missing "query"')
  const r = await safeFetch(`https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=5`)
  const entries: string[] = []
  const re = /<entry>[\s\S]*?<title>([^<]+)<\/title>[\s\S]*?<id>([^<]+)<\/id>[\s\S]*?<summary>([^<]+)<\/summary>/g
  let m; while ((m = re.exec(r.text)) !== null && entries.length < 5) entries.push(`${entries.length+1}. ${m[1].trim()}\n   ${m[2].trim()}\n   ${m[3].trim().slice(0,300)}`)
  return okResult(`arXiv: ${entries.length} papers`, `ARXIV SEARCH: "${query}"\n\n${entries.join('\n\n') || 'No papers found.'}`)
}

/* 5. HackerNews */
export async function toolHackerNewsSearch(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const query = (args?.query ?? '').toString().trim()
  if (!query) return badResult('Missing "query"')
  const r = await safeFetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=5`)
  if (!r.data?.hits) return badResult('HackerNews: no results')
  const results = r.data.hits.map((h: any, i: number) => `${i+1}. ${h.title}\n   https://news.ycombinator.com/item?id=${h.objectID}\n   Points: ${h.points} | Comments: ${h.num_comments}\n   ${h.url || '(HN internal)'}`).join('\n\n')
  return okResult(`HackerNews: ${r.data.hits.length} stories`, `HACKERNEWS SEARCH: "${query}"\n\n${results}`)
}

/* 6. Reddit */
export async function toolRedditSearch(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const query = (args?.query ?? '').toString().trim()
  if (!query) return badResult('Missing "query"')
  const subreddit = (args?.subreddit ?? 'all').toString()
  const r = await safeFetch(`https://www.reddit.com/${subreddit === 'all' ? 'search' : 'r/' + subreddit + '/search'}.json?q=${encodeURIComponent(query)}&limit=5&sort=relevance&restrict_sr=1`)
  if (!r.data?.data?.children) return badResult('Reddit: no results')
  const results = r.data.data.children.map((c: any, i: number) => `${i+1}. ${c.data.title}\n   https://reddit.com${c.data.permalink}\n   Sub: r/${c.data.subreddit} | Score: ${c.data.score} | Comments: ${c.data.num_comments}`).join('\n\n')
  return okResult(`Reddit: ${r.data.data.children.length} posts`, `REDDIT SEARCH: "${query}" (r/${subreddit})\n\n${results}`)
}

/* 7. GitHub */
export async function toolGitHubSearch(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const query = (args?.query ?? '').toString().trim()
  if (!query) return badResult('Missing "query"')
  const type = (args?.type ?? 'repositories').toString()
  const r = await safeFetch(`https://api.github.com/search/${type}?q=${encodeURIComponent(query)}&per_page=5`, { headers: { 'Accept': 'application/vnd.github.v3+json' } })
  if (!r.data?.items) return badResult('GitHub: no results')
  const results = r.data.items.map((item: any, i: number) => {
    if (type === 'repositories') return `${i+1}. ${item.full_name}\n   ${item.html_url}\n   ⭐ ${item.stargazers_count} | 🍴 ${item.forks_count} | ${item.description?.slice(0,200) || ''}`
    if (type === 'users') return `${i+1}. ${item.login}\n   ${item.html_url}\n   Repos: ${item.public_repos} | Followers: ${item.followers}`
    return `${i+1}. ${item.name || item.login || 'unknown'}\n   ${item.html_url || ''}`
  }).join('\n\n')
  return okResult(`GitHub: ${r.data.total_count} results`, `GITHUB SEARCH: "${query}" (${type})\n\n${results}`)
}

/* 8. Stack Overflow */
export async function toolStackOverflowSearch(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const query = (args?.query ?? '').toString().trim()
  if (!query) return badResult('Missing "query"')
  const r = await safeFetch(`https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(query)}&site=stackoverflow&pagesize=5`)
  if (!r.data?.items) return badResult('StackOverflow: no results')
  const results = r.data.items.map((item: any, i: number) => `${i+1}. ${item.title}\n   ${item.link}\n   Score: ${item.score} | Answers: ${item.answer_count} | Tags: ${item.tags?.join(', ')}`).join('\n\n')
  return okResult(`StackOverflow: ${r.data.items.length} questions`, `STACKOVERFLOW SEARCH: "${query}"\n\n${results}`)
}

/* 9. OpenAlex */
export async function toolOpenAlexSearch(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const query = (args?.query ?? '').toString().trim()
  if (!query) return badResult('Missing "query"')
  const r = await safeFetch(`https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=5`)
  if (!r.data?.results) return badResult('OpenAlex: no results')
  const results = r.data.results.map((w: any, i: number) => `${i+1}. ${w.title}\n   DOI: ${w.doi || 'N/A'} | Cited by: ${w.cited_by_count}\n   ${w.publication_year ? 'Year: ' + w.publication_year : ''} | ${w.primary_location?.source?.display_name || ''}`).join('\n\n')
  return okResult(`OpenAlex: ${r.data.count} works`, `OPENALEX SEARCH: "${query}"\n\n${results}`)
}

/* 10. Semantic Scholar */
export async function toolSemanticScholarSearch(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const query = (args?.query ?? '').toString().trim()
  if (!query) return badResult('Missing "query"')
  const r = await safeFetch(`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=5&fields=title,url,abstract,citationCount,year`)
  if (!r.data?.data) return badResult('SemanticScholar: no results')
  const results = r.data.data.map((p: any, i: number) => `${i+1}. ${p.title}\n   ${p.url || ''}\n   Year: ${p.year || 'N/A'} | Citations: ${p.citationCount || 0}\n   ${p.abstract?.slice(0,300) || ''}`).join('\n\n')
  return okResult(`SemanticScholar: ${r.data.total} papers`, `SEMANTIC SCHOLAR: "${query}"\n\n${results}`)
}

/* 11. CORE API */
export async function toolCoreSearch(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const query = (args?.query ?? '').toString().trim()
  if (!query) return badResult('Missing "query"')
  const apiKey = process.env.CORE_API_KEY
  const url = apiKey
    ? `https://api.core.ac.uk/v3/search/works?q=${encodeURIComponent(query)}&limit=5`
    : `https://api.core.ac.uk/v3/search/works?q=${encodeURIComponent(query)}&limit=5`
  const headers: any = apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}
  const r = await safeFetch(url, { headers })
  if (!r.data?.results) return badResult('CORE: no results')
  const results = r.data.results.slice(0, 5).map((w: any, i: number) => `${i+1}. ${w.title}\n   ${w.download_url || w.source_fulltext_urls?.[0] || ''}\n   Year: ${w.year_published || 'N/A'} | Downloads: ${w.download_count || 0}`).join('\n\n')
  return okResult(`CORE: results found`, `CORE SEARCH: "${query}"\n\n${results}`)
}

/* 12. Product Hunt */
export async function toolProductHuntSearch(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const query = (args?.query ?? '').toString().trim()
  if (!query) return badResult('Missing "query"')
  // Use public redirect search (no API key needed)
  const r = await safeFetch(`https://www.producthunt.com/search?q=${encodeURIComponent(query)}`, { headers: { 'Accept': 'text/html' }, timeout: 8000 })
  const titles: string[] = []
  const re = /data-test="post-name"[^>]*>([^<]+)</g
  let m; while ((m = re.exec(r.text)) !== null && titles.length < 5) titles.push(m[1].trim())
  if (titles.length === 0) {
    // Try alternate parsing
    const re2 = /<h3[^>]*>([^<]{10,80})<\/h3>/g
    while ((m = re2.exec(r.text)) !== null && titles.length < 5) titles.push(m[1].trim())
  }
  return okResult(`ProductHunt: ${titles.length} products`, `PRODUCTHUNT SEARCH: "${query}"\n\n${titles.map((t,i) => `${i+1}. ${t}`).join('\n') || 'No products found. Try the website directly.'}`)
}

/* 13. PubMed */
export async function toolPubMedSearch(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const query = (args?.query ?? '').toString().trim()
  if (!query) return badResult('Missing "query"')
  // Step 1: esearch to get IDs
  const er = await safeFetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=5&retmode=json`)
  if (!er.data?.esearchresult?.idlist?.length) return badResult('PubMed: no results')
  const ids = er.data.esearchresult.idlist
  // Step 2: esummary to get details
  const sr = await safeFetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`)
  const results = ids.map((id: string, i: number) => {
    const a = sr.data?.result?.[id]
    return `${i+1}. ${a?.title || 'Untitled'}\n   https://pubmed.ncbi.nlm.nih.gov/${id}/\n   Authors: ${a?.authors?.map((au:any) => au.name).join(', ').slice(0,100) || 'N/A'}\n   Journal: ${a?.source || ''} | Date: ${a?.pubdate || ''}`
  }).join('\n\n')
  return okResult(`PubMed: ${ids.length} articles`, `PUBMED SEARCH: "${query}"\n\n${results}`)
}

/* 14. SearXNG */
export async function toolSearXngSearch(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const query = (args?.query ?? '').toString().trim()
  if (!query) return badResult('Missing "query"')
  // Try multiple public SearXNG instances
  const instances = [
    'https://searx.be/search',
    'https://search.bus-hit.me/search',
    'https://searx.tiekoetter.com/search',
  ]
  for (const base of instances) {
    const r = await safeFetch(`${base}?q=${encodeURIComponent(query)}&format=json&categories=general&pageno=1`, { timeout: 8000 })
    if (r.ok && r.data?.results?.length) {
      const results = r.data.results.slice(0, 5).map((res: any, i: number) => `${i+1}. ${res.title}\n   ${res.url}\n   ${res.content?.slice(0,300) || ''}`).join('\n\n')
      return okResult(`SearXNG: ${r.data.results.length} results`, `SEARXNG SEARCH: "${query}"\n\n${results}`)
    }
  }
  return badResult('SearXNG: all instances failed or returned no results')
}

/* 15. Google Scholar (scraping) */
export async function toolGoogleScholarSearch(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const query = (args?.query ?? '').toString().trim()
  if (!query) return badResult('Missing "query"')
  const r = await safeFetch(`https://scholar.google.com/scholar?q=${encodeURIComponent(query)}&num=5`, { headers: { 'Accept': 'text/html', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }, timeout: 8000 })
  const results: string[] = []
  // Extract titles + URLs + snippets from Google Scholar HTML
  const titleRe = /<h3[^>]*class="gs_rt"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g
  let m; while ((m = titleRe.exec(r.text)) !== null && results.length < 5) results.push(`${results.length+1}. ${m[2].trim()}\n   ${m[1].trim()}`)
  // Extract snippets
  const snippetRe = /<div[^>]*class="gs_rs"[^>]*>([^<]+)</g
  const snippets: string[] = []
  while ((m = snippetRe.exec(r.text)) !== null && snippets.length < 5) snippets.push(m[1].replace(/<[^>]+>/g,'').trim().slice(0,300))
  const formatted = results.map((r, i) => `${r}${snippets[i] ? '\n   ' + snippets[i] : ''}`).join('\n\n')
  return okResult(`Google Scholar: ${results.length} papers`, `GOOGLE SCHOLAR: "${query}"\n\n${formatted || 'No results. Google may be blocking automated requests.'}`)
}
