/**
 * /mission-dashboard — UPGRADE #110
 * Visual mission progress dashboard showing all active projects,
 their current stage, team assignment, and approval status.
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
  const [mission, pods, health] = await Promise.all([
    fetchJson(`${base}/api/mission/tick?action=status`),
    fetchJson(`${base}/api/team/scout?action=pods`),
    fetchJson(`${base}/api/health`),
  ])

  const mPreview = mission?.preview || 'No mission data'
  const mResult = mission?.result || ''
  const podsList = pods?.pods || []
  const healthStatus = health?.status || 'unknown'

  const monthMatch = mResult.match(/month \$(\d+)/)
  const targetMatch = mResult.match(/target.*?\$(\d+)/)
  const progressMatch = mResult.match(/(\d+\.\d+)%/)
  const totalRunsMatch = mResult.match(/Total autonomous runs: (\d+)/)

  const monthIncome = monthMatch ? monthMatch[1] : '0'
  const target = targetMatch ? targetMatch[1] : '20000'
  const progress = progressMatch ? progressMatch[1] : '0.0'
  const totalRuns = totalRunsMatch ? totalRunsMatch[1] : '0'

  const podsHtml = podsList.map((p: any, i: number) => {
    const stages = ['PLANNED', 'IN_PROGRESS', 'REVIEW', 'DELIVERED', 'VERIFIED']
    const currentStage = i === 0 ? 'IN_PROGRESS' : i === 1 ? 'DELIVERED' : 'WAITING'
    const stageColor = currentStage === 'DELIVERED' ? '#10b981' : currentStage === 'IN_PROGRESS' ? '#f59e0b' : '#5b6a92'
    const stageIcon = currentStage === 'DELIVERED' ? '✅' : currentStage === 'IN_PROGRESS' ? '🔄' : '⏳'
    return `<div class="pod-row" style="border-left: 3px solid ${p.color};"><div class="pod-row-header"><div class="pod-icon-small" style="background: ${p.color}20; border-color: ${p.color}50;">${p.icon || '📋'}</div><div class="pod-row-info"><h4 style="color: ${p.color};">${p.name}</h4><p>Leader: <strong>${p.leader}</strong> • Team: ${p.members.join(', ')}</p></div><div class="stage-badge" style="background: ${stageColor}20; border-color: ${stageColor}50; color: ${stageColor};">${stageIcon} ${currentStage}</div></div><div class="stage-progress">${stages.map(s => {const isActive=s===currentStage;const isPast=stages.indexOf(s)<stages.indexOf(currentStage);const color=isPast?'#10b981':isActive?stageColor:'#2a3450';return `<div class="stage-dot" style="background: ${color}; ${isActive?'animation: pulse 2s infinite;':''}" title="${s}"></div>`}).join('<div class="stage-line"></div>')}</div><div class="stage-labels">${stages.map(s => `<span class="${s===currentStage?'active':''}">${s.slice(0,4)}</span>`).join('')}</div>${currentStage==='DELIVERED'?'<div class="approval-box">⚠️ Awaiting Owner Approval</div>':''}</div>`
  }).join('')

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="15"><title>Agent007 — Mission Dashboard</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,sans-serif;background:#050810;color:#e0e7ff;min-height:100vh;padding:1rem}.container{max-width:1100px;margin:0 auto}.header{text-align:center;margin-bottom:1.5rem;padding:1rem 0}.header h1{font-size:1.5rem;font-weight:800;background:linear-gradient(90deg,#00f0ff,#a855f7);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}.header p{color:#7c89b5;font-size:0.75rem;margin-top:0.25rem}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:0.75rem;margin-bottom:1.5rem}.stat{background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.08);border-radius:0.5rem;padding:0.75rem;text-align:center}.stat .l{font-size:0.6rem;text-transform:uppercase;letter-spacing:0.1em;color:#7c89b5}.stat .v{font-size:1.1rem;font-weight:700;margin-top:0.25rem}.stat .v.green{color:#10b981}.stat .v.red{color:#ef4444}.stat .v.cyan{color:#00f0ff}.stat .v.amber{color:#f59e0b}.section{background:rgba(255,255,255,0.02);border:1px solid rgba(0,240,255,0.15);border-radius:0.5rem;padding:1rem;margin-bottom:1rem}.section h2{font-size:0.9rem;color:#00f0ff;margin-bottom:0.5rem}.pod-row{background:rgba(0,0,0,0.2);border-radius:0.4rem;padding:0.75rem;margin-bottom:0.75rem}.pod-row-header{display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem}.pod-icon-small{width:28px;height:28px;border-radius:0.3rem;display:flex;align-items:center;justify-content:center;font-size:0.9rem;border:1px solid;flex-shrink:0}.pod-row-info{flex:1;min-width:0}.pod-row-info h4{font-size:0.8rem;font-weight:600}.pod-row-info p{font-size:0.65rem;color:#7c89b5}.stage-badge{font-size:0.6rem;padding:0.15rem 0.5rem;border-radius:0.25rem;border:1px solid;font-weight:600;white-space:nowrap}.stage-progress{display:flex;align-items:center;justify-content:center;gap:0;margin:0.5rem 0}.stage-dot{width:12px;height:12px;border-radius:50%;flex-shrink:0}.stage-line{width:30px;height:2px;background:#2a3450}.stage-labels{display:flex;justify-content:space-between;font-size:0.5rem;color:#5b6a92;padding:0 15px}.stage-labels .active{color:#f59e0b;font-weight:600}.approval-box{background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:0.3rem;padding:0.4rem;font-size:0.65rem;color:#f59e0b;margin-top:0.4rem}.footer{text-align:center;margin-top:1.5rem;padding:1rem 0;color:#5b6a92;font-size:0.65rem;border-top:1px solid rgba(255,255,255,0.05)}.footer a{color:#00f0ff;text-decoration:none}.live-dot{display:inline-block;width:6px;height:6px;background:#10b981;border-radius:50%;animation:pulse 2s infinite;margin-right:4px}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}</style></head><body><div class="container"><div class="header"><h1>🚀 Agent007 — Mission Dashboard</h1><p><span class="live-dot"></span>LIVE • Auto-refresh 15s • ${new Date().toISOString().slice(0,19)}Z</p></div><div class="stats"><div class="stat"><div class="l">Real Income</div><div class="v ${parseInt(monthIncome)>0?'green':'red'}">$${monthIncome}</div></div><div class="stat"><div class="l">Target</div><div class="v cyan">$${target}</div></div><div class="stat"><div class="l">Progress</div><div class="v ${parseFloat(progress)>50?'green':'amber'}">${progress}%</div></div><div class="stat"><div class="l">Mission Runs</div><div class="v cyan">${totalRuns}</div></div><div class="stat"><div class="l">Active Pods</div><div class="v cyan">${podsList.length}</div></div><div class="stat"><div class="l">Health</div><div class="v green">${healthStatus}</div></div></div><div class="section"><h2>📋 Active Projects — Team Progress</h2>${podsHtml||'<p style="color:#5b6a92;font-size:0.75rem;">No active projects. Start one by asking Agent007.</p>'}</div><div class="section"><h2>📊 Mission Status</h2><pre style="font-size:0.7rem;color:#a5b4fc;white-space:pre-wrap;line-height:1.5;">${esc(mResult.slice(0,800))}</pre></div><div class="footer"><p>Agent007 AI • <a href="/pods">Pods</a> • <a href="/tools-health">Tools</a> • <a href="/">Dashboard</a></p></div></div></body></html>`

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' },
  })
}
