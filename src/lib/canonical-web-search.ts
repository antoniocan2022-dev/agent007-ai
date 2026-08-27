export type CanonicalSearchResult = {
  title?: string
  url?: string
  snippet?: string
  name?: string
}

export async function canonicalWebSearch(query: string, num = 5, recencyDays?: number): Promise<CanonicalSearchResult[]> {
  const q = query.trim()
  if (!q) return []
  const key = process.env.BRAVE_API_KEY
  if (!key) return []
  const params = new URLSearchParams({ q, count: String(Math.max(1, Math.min(20, num))) })
  if (recencyDays && recencyDays > 0) params.set('freshness', `${Math.max(1, Math.ceil(recencyDays))}d`)
  const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params.toString()}`, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': key },
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error(`Brave Search failed: HTTP ${response.status}`)
  const json: any = await response.json()
  const results = Array.isArray(json?.web?.results) ? json.web.results : []
  return results.slice(0, num).map((r: any) => ({ title: r?.title, name: r?.title, url: r?.url, snippet: r?.description ?? r?.snippet ?? '' }))
}
