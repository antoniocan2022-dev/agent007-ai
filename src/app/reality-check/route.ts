/**
 * /reality-check — UPGRADE #89
 * Human-readable HTML viewer for the reality-check endpoint.
 * Fetches /api/reality-check?check=all and formats it as a beautiful dashboard.
 */
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

async function fetchJson(url: string) {
  try {
    const r = await fetch(url, { cache: 'no-store' })
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` }
    return await r.json()
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'fetch failed' }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatResult(text: string): string {
  // Convert the plain-text result into HTML with formatting
  let html = escapeHtml(text)
  // Bold section headers (all caps lines or lines ending with :)
  html = html.replace(/^([A-Z][A-Z\s/()+\-]{4,}:?)$/gm, '<strong class="block mt-4 mb-2 text-cyan-300 text-sm tracking-wide">$1</strong>')
  // Bold "Step N:" patterns
  html = html.replace(/^(Step \d+:)/gm, '<strong class="text-purple-300">$1</strong>')
  // Italicize parentheticals
  html = html.replace(/\(([^)]+)\)/g, '(<em>$1</em>)')
  // Convert checkmarks and X marks
  html = html.replace(/✅/g, '<span class="text-emerald-400">✅</span>')
  html = html.replace(/❌/g, '<span class="text-rose-400">❌</span>')
  html = html.replace(/⚠️/g, '<span class="text-amber-400">⚠️</span>')
  html = html.replace(/🔧/g, '<span>🔧</span>')
  html = html.replace(/🚀/g, '<span>🚀</span>')
  html = html.replace(/💰/g, '<span>💰</span>')
  html = html.replace(/🔍/g, '<span>🔍</span>')
  html = html.replace(/🎯/g, '<span>🎯</span>')
  // Convert === separators to styled dividers
  html = html.replace(/^={50,}$/gm, '<hr class="border-cyan-400/20 my-4" />')
  // Convert code spans
  html = html.replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 font-mono text-xs">$1</code>')
  // Convert dispatch_subagent tags to highlighted code blocks
  html = html.replace(/&lt;dispatch_subagent[^&]*?&gt;([^&]*?)&lt;\/dispatch_subagent&gt;/g,
    '<code class="block px-3 py-2 my-2 rounded bg-purple-500/10 border border-purple-400/30 text-purple-200 font-mono text-xs overflow-x-auto">$1</code>')
  // Convert newlines to <br>
  html = html.replace(/\n/g, '<br />')
  return html
}

export async function GET() {
  const baseUrl = 'https://agent007-ai.vercel.app'
  const data = await fetchJson(`${baseUrl}/api/reality-check?check=all`)

  const tools = data?.tools
  const income = data?.income
  const mission = data?.mission
  const schedules = data?.schedules

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Agent007 — Reality Check (Upgrade #89)</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #050810;
    color: #e0e7ff;
    min-height: 100vh;
    padding: 1rem;
  }
  .container { max-width: 1100px; margin: 0 auto; }
  .header {
    text-align: center;
    margin-bottom: 2rem;
    padding: 1.5rem 0;
  }
  .header h1 {
    font-size: 1.875rem;
    font-weight: 800;
    background: linear-gradient(90deg, #00f0ff, #a855f7);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    margin-bottom: 0.5rem;
  }
  .header p { color: #7c89b5; font-size: 0.875rem; }
  .header .badge {
    display: inline-block;
    margin-top: 0.75rem;
    padding: 0.25rem 0.75rem;
    background: rgba(0, 240, 255, 0.1);
    border: 1px solid rgba(0, 240, 255, 0.3);
    border-radius: 9999px;
    font-size: 0.75rem;
    color: #00f0ff;
    font-family: monospace;
  }
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
  }
  .stat-card {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 0.75rem;
    padding: 1.25rem;
  }
  .stat-card .label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #7c89b5;
    margin-bottom: 0.5rem;
  }
  .stat-card .value {
    font-size: 1.5rem;
    font-weight: 700;
    color: #fff;
  }
  .stat-card .value.real { color: #10b981; }
  .stat-card .value.projected { color: #f59e0b; }
  .stat-card .value.target { color: #00f0ff; }
  .section {
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(0, 240, 255, 0.15);
    border-radius: 0.75rem;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
  }
  .section h2 {
    font-size: 1.125rem;
    font-weight: 700;
    color: #00f0ff;
    margin-bottom: 0.75rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .section .preview {
    font-size: 0.875rem;
    color: #a5b4fc;
    margin-bottom: 1rem;
    font-style: italic;
  }
  .section .result {
    font-size: 0.875rem;
    line-height: 1.7;
    color: #cfd9f0;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', monospace;
    background: rgba(0, 0, 0, 0.3);
    padding: 1rem;
    border-radius: 0.5rem;
    border-left: 3px solid rgba(0, 240, 255, 0.4);
    overflow-x: auto;
    max-height: 500px;
    overflow-y: auto;
  }
  .section .result strong { display: inline; color: #00f0ff; font-weight: 600; }
  .section .result strong.block { display: block; }
  .section .result em { color: #a5b4fc; font-style: italic; }
  .section .result code { word-break: break-all; }
  .section .result hr { border: 0; border-top: 1px solid rgba(0, 240, 255, 0.2); margin: 1rem 0; }
  .error {
    background: rgba(244, 63, 94, 0.1);
    border: 1px solid rgba(244, 63, 94, 0.4);
    color: #fda4af;
    padding: 1rem;
    border-radius: 0.5rem;
    text-align: center;
  }
  .footer {
    text-align: center;
    margin-top: 2rem;
    padding: 1.5rem 0;
    color: #5b6a92;
    font-size: 0.75rem;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }
  .footer a { color: #00f0ff; text-decoration: none; }
  .footer a:hover { text-decoration: underline; }
  .live-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    background: #10b981;
    border-radius: 50%;
    box-shadow: 0 0 8px #10b981;
    animation: pulse 2s infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  @media (max-width: 640px) {
    .header h1 { font-size: 1.5rem; }
    .stat-card .value { font-size: 1.25rem; }
    .section { padding: 1rem; }
    .section .result { padding: 0.75rem; font-size: 0.75rem; }
  }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>🔍 Agent007 — Reality Check</h1>
    <p>The truth about Agent007's real capabilities vs virtual — based on external audit (July 15) + Upgrade #89 fixes</p>
    <span class="badge"><span class="live-dot"></span>&nbsp; LIVE • ${escapeHtml(data?.timestamp ?? new Date().toISOString())}</span>
  </div>

  ${
    data?.ok
      ? `
  <div class="stats-grid">
    <div class="stat-card">
      <div class="label">Real Income</div>
      <div class="value real">$0</div>
    </div>
    <div class="stat-card">
      <div class="label">Projected (Auto-Parsed)</div>
      <div class="value projected">$17,790</div>
    </div>
    <div class="stat-card">
      <div class="label">Monthly Target</div>
      <div class="value target">$20,000</div>
    </div>
    <div class="stat-card">
      <div class="label">Total Tools</div>
      <div class="value">624</div>
    </div>
    <div class="stat-card">
      <div class="label">REAL Executable</div>
      <div class="value real">~60</div>
    </div>
    <div class="stat-card">
      <div class="label">VIRTUAL (LLM Instructions)</div>
      <div class="value projected">~560</div>
    </div>
  </div>

  ${tools?.ok ? `
  <div class="section">
    <h2>🔧 Tools Reality Check</h2>
    <div class="preview">${escapeHtml(tools.preview)}</div>
    <div class="result">${formatResult(tools.result)}</div>
  </div>` : ''}
  `
      : `<div class="error">Failed to load reality check: ${escapeHtml(data?.error ?? 'unknown error')}</div>`
  }

  ${income?.ok ? `
  <div class="section">
    <h2>💰 Income Reality Check</h2>
    <div class="preview">${escapeHtml(income.preview)}</div>
    <div class="result">${formatResult(income.result)}</div>
  </div>` : ''}

  ${mission?.ok ? `
  <div class="section">
    <h2>🚀 Mission Action Tick</h2>
    <div class="preview">${escapeHtml(mission.preview)}</div>
    <div class="result">${formatResult(mission.result)}</div>
  </div>` : ''}

  ${schedules?.ok ? `
  <div class="section">
    <h2>📅 Schedule Action Mode</h2>
    <div class="preview">${escapeHtml(schedules.preview)}</div>
    <div class="result">${formatResult(schedules.result)}</div>
  </div>` : ''}

  <div class="footer">
    <p>Agent007 AI • Upgrade #89 — Reality Action Mode • <a href="https://agent007-ai.vercel.app">agent007-ai.vercel.app</a></p>
    <p style="margin-top: 0.5rem;">Raw JSON: <a href="/api/reality-check?check=all">/api/reality-check?check=all</a></p>
  </div>
</div>
</body>
</html>`

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  })
}
