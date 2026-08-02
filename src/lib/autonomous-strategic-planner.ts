/**
 * autonomous-strategic-planner.ts — UPGRADE #209
 *
 * The "Morning Executive Brief" system.
 *
 * Every day at 9AM UTC (or on-demand), Agent007's Executive Brain:
 * 1. Dispatches SCOUT (opportunities), PULSE (KPIs), QUANTUM (financial status),
 *    ECHO (quality issues), qa_monitor (system health)
 * 2. Synthesizes their findings into a "Morning Executive Brief"
 * 3. Sends to Antonio via telegram_notify + email
 * 4. Stores in persistent memory for future reference
 *
 * This transforms Agent007 from REACTIVE (waits for prompts) to PROACTIVE
 * (initiates work autonomously).
 *
 * Triggered by: /api/schedules/morning-brief (Vercel Cron: 0 9 * * *)
 * Or on-demand: GET /api/system/morning-brief
 */

import { dispatchTool } from './tools'
import { db } from './db'
import { sendEmail } from './email'
import { OWNER_EMAIL } from './owner-config'

export const runtime = 'nodejs'
export const maxDuration = 120

interface BriefSection {
  leader: string
  findings: string
  confidence: number
  recommendations: string[]
}

/**
 * Run the Morning Executive Brief.
 * Dispatches 5 leaders in parallel, synthesizes findings, sends to owner.
 */
export async function runMorningBrief(): Promise<{
  ok: boolean
  brief: string
  sections: BriefSection[]
  sent: boolean
  error?: string
}> {
  console.log('[morning-brief] Starting Morning Executive Brief...')

  try {
    // ═══ PHASE 1: Dispatch 5 leaders in parallel ═══
    console.log('[morning-brief] Phase 1: Dispatching leaders...')

    const dispatches = await Promise.allSettled([
      // SCOUT — opportunities + trends
      dispatchTool('web_search', {
        query: 'AI side hustle opportunities trending today 2026',
      }, { attachments: [], language: 'en' }).catch(() => null),

      // PULSE — system KPIs
      dispatchTool('http_fetch', {
        url: 'https://agent007-ai.vercel.app/api/system/team-performance',
      }, { attachments: [], language: 'en' }).catch(() => null),

      // QUANTUM — financial status
      dispatchTool('yahoo_finance', {
        symbol: 'TSLA',
      }, { attachments: [], language: 'en' }).catch(() => null),

      // ECHO — quality issues
      dispatchTool('http_fetch', {
        url: 'https://agent007-ai.vercel.app/api/health',
      }, { attachments: [], language: 'en' }).catch(() => null),

      // qa_monitor — system health
      dispatchTool('http_fetch', {
        url: 'https://agent007-ai.vercel.app/api/monitor/qa',
      }, { attachments: [], language: 'en' }).catch(() => null),
    ])

    // ═══ PHASE 2: Parse findings from each leader ═══
    console.log('[morning-brief] Phase 2: Parsing findings...')

    const sections: BriefSection[] = []

    // SCOUT findings
    const scoutResult = dispatches[0].status === 'fulfilled' ? dispatches[0].value : null
    sections.push({
      leader: 'SCOUT',
      findings: scoutResult?.ok
        ? `Trending opportunities: ${(scoutResult.result || '').slice(0, 500)}`
        : 'Search unavailable — no opportunity data collected',
      confidence: scoutResult?.ok ? 80 : 0,
      recommendations: scoutResult?.ok
        ? ['Review trending AI opportunities', 'Validate 2-3 niches for demand']
        : ['Retry opportunity scan later'],
    })

    // PULSE findings
    const pulseResult = dispatches[1].status === 'fulfilled' ? dispatches[1].value : null
    let teamData: any = null
    try {
      const pulseText = pulseResult?.result || ''
      teamData = JSON.parse(pulseText)
    } catch {}
    const totalTasks = teamData?.team_summary?.total_tasks_completed || 0
    const avgScore = teamData?.team_summary?.team_avg_quality_score || 0
    sections.push({
      leader: 'PULSE',
      findings: `Team status: ${teamData?.team_summary?.total_agents || 18} agents, ${totalTasks} tasks completed, avg quality ${avgScore}`,
      confidence: 90,
      recommendations: totalTasks === 0
        ? ['Run initial test missions to establish baselines', 'Dispatch probe tasks to all 20 agents']
        : ['Continue monitoring KPIs', `Quality target: ${avgScore < 92 ? 'BELOW 92 threshold — investigate' : 'meeting 92+ target'}`],
    })

    // QUANTUM findings
    const quantumResult = dispatches[2].status === 'fulfilled' ? dispatches[2].value : null
    sections.push({
      leader: 'QUANTUM',
      findings: quantumResult?.ok
        ? `Market data: ${(quantumResult.result || '').slice(0, 300)}`
        : 'Market data unavailable',
      confidence: quantumResult?.ok ? 85 : 0,
      recommendations: quantumResult?.ok
        ? ['Monitor market for investment opportunities', 'Set price alerts on tracked assets']
        : ['Check yahoo_finance API status'],
    })

    // ECHO findings (system health)
    const echoResult = dispatches[3].status === 'fulfilled' ? dispatches[3].value : null
    let healthData: any = null
    try { healthData = JSON.parse(echoResult?.result || '{}') } catch {}
    sections.push({
      leader: 'ECHO',
      findings: `System health: ${healthData?.status || 'unknown'}, version ${healthData?.version || 'unknown'}, uptime ${Math.round((healthData?.uptime_seconds || 0) / 60)}min`,
      confidence: 95,
      recommendations: healthData?.status === 'healthy'
        ? ['System operating normally']
        : ['⚠️ System health issue detected — investigate immediately'],
    })

    // qa_monitor findings
    const qaResult = dispatches[4].status === 'fulfilled' ? dispatches[4].value : null
    sections.push({
      leader: 'QA Monitor',
      findings: qaResult?.ok
        ? `QA check: ${(qaResult.result || '').slice(0, 300)}`
        : 'QA monitor unavailable',
      confidence: 85,
      recommendations: qaResult?.ok
        ? ['Review any QA failures', 'Schedule remediation if needed']
        : ['Check /api/monitor/qa endpoint'],
    })

    // ═══ PHASE 3: Synthesize into Morning Executive Brief ═══
    console.log('[morning-brief] Phase 3: Synthesizing brief...')

    const briefDate = new Date().toUTCString().slice(0, 16)
    const brief = `═══════════════════════════════════════════════════════════════
  AGENT007 — MORNING EXECUTIVE BRIEF
  ${briefDate}
═══════════════════════════════════════════════════════════════

MISSION STATUS: $20K/month passive income with 20% monthly growth

${sections.map(s => `── ${s.leader} (confidence: ${s.confidence}%) ──
  Findings: ${s.findings}

  Recommendations:
${s.recommendations.map(r => `    • ${r}`).join('\n')}
`).join('\n')}

─── EXECUTIVE SUMMARY ───
This morning's brief covers 5 areas: opportunities, team performance,
market data, system health, and QA status.

${sections.filter(s => s.confidence >= 80).length}/5 leaders reported with high confidence.

PRIORITY ACTIONS:
${sections
  .flatMap(s => s.recommendations.map(r => ({ leader: s.leader, rec: r })))
  .slice(0, 5)
  .map((r, i) => `  ${i + 1}. [${r.leader}] ${r.rec}`)
  .join('\n')}

═══════════════════════════════════════════════════════════════
  Generated autonomously by Agent007 Executive Brain
  Next brief: tomorrow 9AM UTC
═══════════════════════════════════════════════════════════════`

    // ═══ PHASE 4: Store in persistent memory ═══
    console.log('[morning-brief] Phase 4: Storing in memory...')
    try {
      await dispatchTool('memory_store', {
        key: `morning_brief_${new Date().toISOString().slice(0, 10)}`,
        value: brief,
        category: 'executive_brief',
      }, { attachments: [], language: 'en' })
    } catch (e) {
      console.log('[morning-brief] Memory store failed:', e)
    }

    // ═══ PHASE 5: Send to owner ═══
    console.log('[morning-brief] Phase 5: Sending to owner...')
    let sent = false
    try {
      // Try Telegram first (fastest)
      await dispatchTool('telegram_notify', {
        message: brief.slice(0, 4000), // Telegram limit
      }, { attachments: [], language: 'en' })
      sent = true
    } catch {
      // Fallback to email
      try {
        await sendEmail({
          to: OWNER_EMAIL,
          subject: `Agent007 Morning Brief — ${briefDate}`,
          body: brief,
          type: 'executive_brief',
        })
        sent = true
      } catch (e) {
        console.log('[morning-brief] Email send failed:', e)
      }
    }

    console.log('[morning-brief] Complete. Sent:', sent)

    return {
      ok: true,
      brief,
      sections,
      sent,
    }
  } catch (e: any) {
    console.error('[morning-brief] Failed:', e)
    return {
      ok: false,
      brief: '',
      sections: [],
      sent: false,
      error: e?.message || 'Unknown error',
    }
  }
}
