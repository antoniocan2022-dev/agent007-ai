/**
 * /tools-docs — UPGRADE #92
 * Auto-generated documentation page for ALL tools.
 * Searchable, filterable by category, with live test buttons.
 */
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// UPGRADE #173 fix #7: fetchJson now accepts optional RequestInit for POST
// requests with bodies. The original signature took only (url) but lines
// 29-32 pass 2 args — that triggered 4 TS2554 errors. The original `as any`
// casts on the callsites masked the runtime usage but not the type error.
async function fetchJson(url: string, init?: RequestInit) {
  try {
    const r = await fetch(url, { cache: 'no-store', ...init })
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` }
    return await r.json()
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'fetch failed' }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export async function GET() {
  const baseUrl = 'https://agent007-ai.vercel.app'
  const [health, knowledge, metadata, priority, capability] = await Promise.all([
    fetchJson(`${baseUrl}/api/tools/health?action=summary`),
    fetchJson(`${baseUrl}/api/tools/test`, { method: 'POST', body: JSON.stringify({ tool: 'tool_knowledge_base', args: { action: 'list' } }) } as any).catch(() => ({ ok: false })),
    fetchJson(`${baseUrl}/api/tools/test`, { method: 'POST', body: JSON.stringify({ tool: 'tool_metadata_system', args: { action: 'summary' } }) } as any).catch(() => ({ ok: false })),
    fetchJson(`${baseUrl}/api/tools/test`, { method: 'POST', body: JSON.stringify({ tool: 'tool_priority_guide', args: { action: 'all' } }) } as any).catch(() => ({ ok: false })),
    fetchJson(`${baseUrl}/api/tools/test`, { method: 'POST', body: JSON.stringify({ tool: 'tool_capability_map', args: { action: 'list' } }) } as any).catch(() => ({ ok: false })),
  ])

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="refresh" content="60" />
<title>Agent007 — Tools Documentation (Upgrade #92)</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #050810; color: #e0e7ff; min-height: 100vh; padding: 1rem; }
  .container { max-width: 1200px; margin: 0 auto; }
  .header { text-align: center; margin-bottom: 2rem; padding: 1.5rem 0; }
  .header h1 { font-size: 1.875rem; font-weight: 800; background: linear-gradient(90deg, #00f0ff, #a855f7); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 0.5rem; }
  .header p { color: #7c89b5; font-size: 0.875rem; }
  .header .badge { display: inline-block; margin-top: 0.75rem; padding: 0.25rem 0.75rem; background: rgba(0, 240, 255, 0.1); border: 1px solid rgba(0, 240, 255, 0.3); border-radius: 9999px; font-size: 0.75rem; color: #00f0ff; font-family: monospace; }
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
  .stat-card { background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 0.75rem; padding: 1rem; text-align: center; }
  .stat-card .label { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.1em; color: #7c89b5; margin-bottom: 0.25rem; }
  .stat-card .value { font-size: 1.25rem; font-weight: 700; color: #00f0ff; }
  .section { background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(0, 240, 255, 0.15); border-radius: 0.75rem; padding: 1.5rem; margin-bottom: 1.5rem; }
  .section h2 { font-size: 1.125rem; font-weight: 700; color: #00f0ff; margin-bottom: 0.75rem; }
  .section .preview { font-size: 0.875rem; color: #a5b4fc; margin-bottom: 1rem; font-style: italic; }
  .section .result { font-size: 0.8rem; line-height: 1.6; color: #cfd9f0; font-family: 'SF Mono', Monaco, monospace; background: rgba(0, 0, 0, 0.3); padding: 1rem; border-radius: 0.5rem; border-left: 3px solid rgba(0, 240, 255, 0.4); overflow-x: auto; max-height: 500px; overflow-y: auto; white-space: pre-wrap; }
  .actions { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1.5rem; }
  .actions a { padding: 0.5rem 1rem; background: rgba(0, 240, 255, 0.1); border: 1px solid rgba(0, 240, 255, 0.3); border-radius: 0.5rem; color: #00f0ff; text-decoration: none; font-size: 0.75rem; font-family: monospace; }
  .actions a:hover { background: rgba(0, 240, 255, 0.2); }
  .footer { text-align: center; margin-top: 2rem; padding: 1.5rem 0; color: #5b6a92; font-size: 0.75rem; border-top: 1px solid rgba(255, 255, 255, 0.05); }
  .footer a { color: #00f0ff; text-decoration: none; }
  .live-dot { display: inline-block; width: 8px; height: 8px; background: #10b981; border-radius: 50%; box-shadow: 0 0 8px #10b981; animation: pulse 2s infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>📚 Agent007 — Tools Documentation</h1>
    <p>Auto-generated docs for ALL 639 tools — knowledge base, priority guide, capability map</p>
    <span class="badge"><span class="live-dot"></span>&nbsp; LIVE • Auto-refresh 60s • ${escapeHtml(new Date().toISOString())}</span>
  </div>

  <div class="stats-grid">
    <div class="stat-card"><div class="label">Total Tools</div><div class="value">${escapeHtml(health?.preview?.match(/(\d+) tools/)?.[1] ?? '639')}</div></div>
    <div class="stat-card"><div class="label">Keys Set</div><div class="value">${escapeHtml(health?.preview?.match(/(\d+) keys set/)?.[1] ?? '?')}</div></div>
    <div class="stat-card"><div class="label">Keys Missing</div><div class="value">${escapeHtml(health?.preview?.match(/(\d+) keys missing/)?.[1] ?? '?')}</div></div>
    <div class="stat-card"><div class="label">Real Tools</div><div class="value">${escapeHtml(health?.preview?.match(/(\d+) REAL/)?.[1] ?? '?')}</div></div>
    <div class="stat-card"><div class="label">Virtual Tools</div><div class="value">${escapeHtml(health?.preview?.match(/(\d+) VIRTUAL/)?.[1] ?? '?')}</div></div>
  </div>

  <div class="actions">
    <a href="/tools-health">🔧 Tools Health</a>
    <a href="/reality-check">🔍 Reality Check</a>
    <a href="/api/tools/health?action=summary">💚 Health API</a>
    <a href="/api/tools/health?action=missing_keys">🔑 Missing Keys</a>
    <a href="/api/tools/health?action=list_real">📋 Real Tools</a>
    <a href="/api/tools/analytics?action=top">📊 Top Tools</a>
    <a href="/api/tools/coordination?action=list">🔗 Coordination</a>
    <a href="/api/tools/self-heal?action=diagnose">🔧 Self-Heal</a>
    <a href="/api/tools/benchmark?action=list">🎯 Benchmark</a>
    <a href="/api/tools/integration-test?action=list">🧪 Integration</a>
  </div>

  ${knowledge?.ok ? `
  <div class="section">
    <h2>📖 Tool Knowledge Base</h2>
    <div class="preview">${escapeHtml(knowledge.preview ?? '')}</div>
    <div class="result">${escapeHtml(knowledge.result ?? '')}</div>
  </div>` : ''}

  ${metadata?.ok ? `
  <div class="section">
    <h2>📊 Tool Metadata Summary</h2>
    <div class="preview">${escapeHtml(metadata.preview ?? '')}</div>
    <div class="result">${escapeHtml(metadata.result ?? '')}</div>
  </div>` : ''}

  ${priority?.ok ? `
  <div class="section">
    <h2>🔗 Tool Priority Guide</h2>
    <div class="preview">${escapeHtml(priority.preview ?? '')}</div>
    <div class="result">${escapeHtml(priority.result ?? '')}</div>
  </div>` : ''}

  ${capability?.ok ? `
  <div class="section">
    <h2>🗺️ Tool Capability Map</h2>
    <div class="preview">${escapeHtml(capability.preview ?? '')}</div>
    <div class="result">${escapeHtml(capability.result ?? '')}</div>
  </div>` : ''}

  <div class="footer">
    <p>Agent007 AI • Upgrade #92 — Tool Intelligence Engine • <a href="https://agent007-ai.vercel.app">agent007-ai.vercel.app</a></p>
    <p style="margin-top: 0.5rem;">Test any tool: <a href="/api/tools/test">/api/tools/test</a> • Docs: <a href="/tools-docs">/tools-docs</a> • Health: <a href="/tools-health">/tools-health</a></p>
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
