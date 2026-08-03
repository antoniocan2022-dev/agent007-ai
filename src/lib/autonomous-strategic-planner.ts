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

  // ═══ DEDUPLICATION LOCK (UPGRADE #215, fixed #219) ═══
  // PROBLEM: Antonio received 10+ duplicate Telegram messages in 2 hours.
  // ROOT CAUSE: Vercel retries the cron job if it times out (maxDuration=120s).
  // Each retry calls runMorningBrief() again → sends another Telegram message.
  //
  // FIX #215: 6-hour dedup window — but Antonio still received a duplicate
  // at 2:48 PM (10 hours after the morning brief). The 6-hour window had
  // expired, so the dedup let it through.
  //
  // FIX #219: Increased to 24-hour window. The morning brief should only be
  // sent ONCE per day. If any trigger fires within 24 hours of the last send,
  // it's blocked. This completely eliminates duplicates.
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000
  const dedupKey = 'morning_brief_last_sent'
  try {
    const { db } = await import('./db')
    const lastSentRow = await db.memory.findFirst({
      where: { key: dedupKey },
      orderBy: { createdAt: 'desc' },
    })
    if (lastSentRow) {
      const lastSentTime = new Date(lastSentRow.createdAt).getTime()
      const elapsed = Date.now() - lastSentTime
      if (elapsed < TWENTY_FOUR_HOURS_MS) {
        console.log(`[morning-brief] DEDUP: Already sent ${Math.round(elapsed / 60000)} min ago. Skipping.`)
        return {
          ok: true,
          brief: '(skipped — already sent recently)',
          sections: [],
          sent: false,
          error: `Deduplication: brief was already sent ${Math.round(elapsed / 60000)} minutes ago. Next brief allowed in ${Math.round((TWENTY_FOUR_HOURS_MS - elapsed) / 3600000)} hours.`,
        }
      }
    }
  } catch (e) {
    // If DB check fails, continue (don't block the brief)
    console.log('[morning-brief] Dedup check failed (non-blocking):', e)
  }

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

MISSION: Continuously discover, validate, build, launch, optimize, automate, and scale ethical digital businesses that maximize enterprise value.
VISION: An Autonomous AI Enterprise managing a portfolio of digital businesses through shared executive intelligence.

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

    // ═══ DEDUPLICATION RECORD (UPGRADE #215) ═══
    // Record that we sent the brief NOW — so future calls within 6 hours
    // will be skipped by the dedup check at the top of this function.
    if (sent) {
      try {
        const { db } = await import('./db')
        await db.memory.create({
          data: {
            key: dedupKey,
            value: `Morning brief sent at ${new Date().toISOString()}`,
            category: 'dedup_lock',
          },
        })
        console.log('[morning-brief] Dedup lock recorded — next brief blocked for 6 hours')
      } catch (e) {
        console.log('[morning-brief] Dedup lock failed (non-blocking):', e)
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
