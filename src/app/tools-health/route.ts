/**
 * /tools-health — HTML dashboard showing live status of ALL tools.
 */
import { NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
export const revalidate = 0

async function fetchJson(url: string) {
  try {
    const r = await fetch(url, { cache: 'no-store' })
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` }
    return await r.json()
  } catch (e: any) { return { ok: false, error: e?.message } }
}
function esc(s: string): string { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }

export async function GET() {
  const base = 'https://agent007-ai.vercel.app'
  const [health, selfHeal] = await Promise.all([
    fetchJson(`${base}/api/tools/health?action=summary`),
    fetchJson(`${base}/api/tools/self-heal?action=diagnose`),
  ])
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="30"><title>Agent007 — Tools Health</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,sans-serif;background:#050810;color:#e0e7ff;padding:1rem}.c{max-width:1100px;margin:0 auto}.h{text-align:center;margin-bottom:2rem;padding:1.5rem 0}.h h1{font-size:1.875rem;font-weight:800;background:linear-gradient(90deg,#00f0ff,#a855f7);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}.s{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem;margin-bottom:2rem}.sc{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:0.75rem;padding:1.25rem}.sc .l{font-size:0.7rem;text-transform:uppercase;letter-spacing:0.1em;color:#7c89b5;margin-bottom:0.5rem}.sc .v{font-size:1.5rem;font-weight:700;color:#00f0ff}.sec{background:rgba(255,255,255,0.02);border:1px solid rgba(0,240,255,0.15);border-radius:0.75rem;padding:1.5rem;margin-bottom:1.5rem}.sec h2{font-size:1.125rem;font-weight:700;color:#00f0ff;margin-bottom:0.75rem}.sec .r{font-size:0.8rem;line-height:1.7;color:#cfd9f0;font-family:monospace;background:rgba(0,0,0,0.3);padding:1rem;border-radius:0.5rem;border-left:3px solid rgba(0,240,255,0.4);overflow-x:auto;max-height:400px;overflow-y:auto;white-space:pre-wrap}.a{display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:1.5rem}.a a{padding:0.5rem 1rem;background:rgba(0,240,255,0.1);border:1px solid rgba(0,240,255,0.3);border-radius:0.5rem;color:#00f0ff;text-decoration:none;font-size:0.75rem;font-family:monospace}.f{text-align:center;margin-top:2rem;padding:1.5rem 0;color:#5b6a92;font-size:0.75rem;border-top:1px solid rgba(255,255,255,0.05)}.f a{color:#00f0ff}.dot{display:inline-block;width:8px;height:8px;background:#10b981;border-radius:50%;box-shadow:0 0 8px #10b981;animation:p 2s infinite}@keyframes p{0%,100%{opacity:1}50%{opacity:0.5}}</style></head><body><div class="c"><div class="h"><h1>🔧 Agent007 — Tools Health</h1><p>Live status of all 639 tools — functionality, coordination, accuracy</p><p style="margin-top:0.75rem"><span class="dot"></span> LIVE • Auto-refresh 30s • ${esc(new Date().toISOString())}</p></div>
<div class="s"><div class="sc"><div class="l">Total Tools</div><div class="v">${esc(health?.preview?.match(/(\d+) tools/)?.[1]??'639')}</div></div><div class="sc"><div class="l">Keys Set</div><div class="v">${esc(health?.preview?.match(/(\d+) keys set/)?.[1]??'?')}</div></div><div class="sc"><div class="l">Keys Missing</div><div class="v">${esc(health?.preview?.match(/(\d+) keys missing/)?.[1]??'?')}</div></div><div class="sc"><div class="l">REAL Tools</div><div class="v">${esc(health?.preview?.match(/(\d+) REAL/)?.[1]??'?')}</div></div><div class="sc"><div class="l">VIRTUAL Tools</div><div class="v">${esc(health?.preview?.match(/(\d+) VIRTUAL/)?.[1]??'?')}</div></div></div>
<div class="a"><a href="/api/tools/test?tool=web_search">▶ Test web_search</a><a href="/api/tools/health?action=missing_keys">🔍 Missing Keys</a><a href="/api/tools/analytics?action=top">📊 Top Tools</a><a href="/api/tools/coordination?action=list">🔗 Coordination</a><a href="/api/tools/self-heal?action=diagnose">🔧 Self-Heal</a><a href="/api/tools/benchmark?action=list">🎯 Benchmark</a><a href="/tools-docs">📚 Docs</a><a href="/reality-check">🔍 Reality Check</a></div>
${selfHeal?.ok?`<div class="sec"><h2>🔧 Self-Healing Diagnosis</h2><div class="r">${esc(selfHeal.result??'')}</div></div>`:''}
${health?.ok?`<div class="sec"><h2>💚 Tool Health Summary</h2><div class="r">${esc(health.result??'')}</div></div>`:''}
<div class="f"><p>Agent007 AI • <a href="https://agent007-ai.vercel.app">agent007-ai.vercel.app</a></p><p style="margin-top:0.5rem">API: <a href="/api/tools/health">/api/tools/health</a> • <a href="/api/tools/test">/api/tools/test</a> • <a href="/tools-docs">/tools-docs</a></p></div></div></body></html>`
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' } })
}
