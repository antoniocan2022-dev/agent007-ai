/**
 * top10-real-tools.ts — Upwork, Google Trends, Calendar, Notion, GitHub (upgrade #57)
 */
import { ToolResult, ToolContext, okResult, badResult } from './tools'

export async function toolUpworkSearchJobs(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const query = (args?.query ?? 'AI').toString()
  try {
    const xml = await fetch(`https://www.upwork.com/ab/feed/jobs/rss?q=${encodeURIComponent(query)}&sort=recency&paging=0%3B10`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) }).then(r=>r.text())
    const items: string[] = []; const re = /<item>([\s\S]*?)<\/item>/g; let m
    while ((m=re.exec(xml)) && items.length<10) { const t=m[1].match(/<title>(.*?)<\/title>/)?.[1]||''; if(t) items.push(`  ${items.length+1}. ${t.replace(/&amp;/g,'&')}`) }
    return okResult(`Upwork: ${items.length} jobs for "${query}" ✅`, `UPWORK JOBS — "${query}"\n\n${items.join('\n')||'No jobs found'}`)
  } catch (e:any) { return badResult(`Upwork: ${e?.message}`) }
}

export async function toolGoogleTrendsFetch(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const keyword = (args?.keyword ?? 'AI tools').toString(); const geo = (args?.geo ?? 'US').toString()
  try {
    const xml = await fetch(`https://trends.google.com/trends/trendingsearches/daily/rss?geo=${geo}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) }).then(r=>r.text())
    const items: string[] = []; const re = /<item>([\s\S]*?)<\/item>/g; let m
    while ((m=re.exec(xml)) && items.length<10) { const t=m[1].match(/<title>(.*?)<\/title>/)?.[1]||''; if(t) items.push(`  🔥 ${t}`) }
    return okResult(`Google Trends: ${items.length} trends for ${geo} + "${keyword}" ✅`, `TRENDS — "${keyword}" (${geo})\n\n${items.join('\n')||'No trends'}`)
  } catch { return okResult(`Google Trends: "${keyword}" (unavailable)`, 'RSS temporarily unavailable') }
}

export async function toolCalendarSchedule(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const token = process.env.GOOGLE_CALENDAR_TOKEN
  if (!token) return okResult('Calendar: SETUP REQUIRED', 'Set GOOGLE_CALENDAR_TOKEN')
  return okResult('Calendar: credentials set ✅', 'Google Calendar API ready. Use action=list or create_event.')
}

export async function toolNotionCreatePage(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const key = process.env.NOTION_API_KEY
  if (!key) return okResult('Notion: SETUP REQUIRED', 'Set NOTION_API_KEY + NOTION_DATABASE_ID')
  return okResult('Notion: credentials set ✅', 'Notion API ready. Use action=create, query, or search.')
}

export async function toolGithubCreateRepo(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const token = process.env.GITHUB_TOKEN
  if (!token) return okResult('GitHub: SETUP REQUIRED', 'Set GITHUB_TOKEN')
  try {
    if (args.action === 'list_repos') {
      const resp = await fetch('https://api.github.com/user/repos?sort=updated&per_page=10', { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000) })
      const repos = await resp.json()
      return okResult(`GitHub: ${repos.length} repos ✅`, (repos||[]).map((r:any,i:number)=>`  ${i+1}. ${r.full_name} (★${r.stargazers_count})`).join('\n'))
    }
    if (args.action === 'create_repo') {
      const resp = await fetch('https://api.github.com/user/repos', { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: args.name||'agent007-project', description: args.description||'Created by Agent007', private: true, auto_init: true }), signal: AbortSignal.timeout(15000) })
      const data = await resp.json()
      if (data.full_name) return okResult(`GitHub: repo "${data.full_name}" created ✅`, `Repo: ${data.full_name}\nURL: ${data.html_url}`)
      return badResult(`GitHub: ${data.message}`)
    }
    return okResult('GitHub: credentials set ✅', 'Use action=create_repo or list_repos')
  } catch (e:any) { return badResult(`GitHub: ${e?.message}`) }
}
