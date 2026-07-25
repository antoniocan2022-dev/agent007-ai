/**
 * ceo-presenter.ts — UPGRADE #138 (CEO Final Presenter — Rec 3)
 * ===================================================================
 * The CEO is not just a dispatcher — it is the FINAL AGGREGATOR that:
 *   1. Collects all stage artifacts from a completed mission
 *   2. Formats a human-readable executive report
 *   3. Presents it to the owner via:
 *        - Saved to DB (MissionApprovalLog + UserSetting)
 *        - Telegram notification
 *        - Dashboard mission status update
 *        - Optional: email (if OWNER_EMAIL set)
 *
 * This file is consumed by mission-pipeline.ts at the end of every pipeline.
 */

import { callLlmWithRetry } from './agent'
import { db } from './db'

export interface MissionStageSummary {
  stage: number
  team: string
  leader: string
  artifactValue: string | null
  artifactVerified: boolean
  finalScore: number
  rounds: number
  approvedAt: string | null
}

export interface CeoReport {
  missionId: string
  missionTitle: string
  objective: string
  outcome: 'success' | 'partial' | 'failed'
  revenueImpact: string
  keyDeliverables: string[]
  risksNotes: string[]
  nextSteps: string[]
  fullReport: string
  generatedAt: string
}

const CEO_SYSTEM_PROMPT = `You are the CEO of Agent007 — the apex executive that reports to the human owner (Antonio).

A mission has just completed all of its stages. Your job: AGGREGATE everything the teams produced and present a CLEAR, EXECUTIVE summary to Antonio.

Antonio is busy. He needs to understand:
1. Did the mission succeed? (success / partial / failed)
2. What was actually delivered? (URLs, files, transaction IDs — concrete artifacts, not promises)
3. What is the revenue impact? (if applicable)
4. What risks or notes should he be aware of?
5. What are the next 3 recommended actions?

FORMAT (strict):
🎯 MISSION: [one-line description]
📊 OUTCOME: [success/partial/failed]
💰 REVENUE IMPACT: [if applicable, otherwise "N/A"]
✅ KEY DELIVERABLES:
   - [bullet list with URLs/IDs]
⚠️ RISKS/NOTES:
   - [if any, otherwise "None"]
📈 NEXT STEPS:
   1. [action]
   2. [action]
   3. [action]

RULES:
- Keep the report under 300 words.
- Be honest — if delivery failed, say so. Antonio trusts the CEO because the CEO never lies.
- Quote real artifact values (URLs, IDs), not vague descriptions.
- If revenue is $0, say "$0 so far — see next steps for monetization plan".`

/**
 * Generate a CEO report for a completed mission.
 */
export async function ceoGenerateReport(opts: {
  missionId: string
  missionTitle: string
  objective: string
  stages: MissionStageSummary[]
}): Promise<CeoReport> {
  const { missionId, missionTitle, objective, stages } = opts

  const stagesBlock = stages.map((s) =>
    `Stage ${s.stage} (${s.team}/${s.leader}):
  - Artifact: ${s.artifactValue ?? '(none)'}
  - Verified: ${s.artifactVerified ? 'YES' : 'NO'}
  - Final score: ${s.finalScore}/100 (after ${s.rounds} round(s))
  - Approved at: ${s.approvedAt ?? '(not approved)'}`
  ).join('\n\n')

  const userPrompt = `MISSION TITLE: ${missionTitle}
MISSION OBJECTIVE: ${objective}

STAGES COMPLETED (${stages.length} total):
${stagesBlock}

Generate the executive report for Antonio now. Follow the FORMAT exactly.`

  let fullReport: string
  try {
    const response = await callLlmWithRetry([
      { role: 'system', content: CEO_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ], { thinking: false })

    fullReport = typeof response === 'string'
      ? response
      : (response?.content ?? response?.message?.content ?? '')
  } catch {
    // LLM failed — generate a minimal fallback report
    fullReport = `🎯 MISSION: ${missionTitle}
📊 OUTCOME: partial (CEO LLM unavailable — auto-generated report)
💰 REVENUE IMPACT: See artifacts below
✅ KEY DELIVERABLES:
${stages.map((s) => `   - Stage ${s.stage} (${s.team}): ${s.artifactValue ?? '(no artifact)'}`).join('\n')}
⚠️ RISKS/NOTES:
   - CEO LLM was unavailable; this is a fallback report.
📈 NEXT STEPS:
   1. Review each stage's artifact manually.
   2. Approve or request changes via the dashboard.
   3. Schedule the next mission.`
  }

  // Derive outcome from stage results
  const allApproved = stages.every((s) => s.artifactVerified && s.finalScore >= 70)
  const someApproved = stages.some((s) => s.artifactVerified)
  const outcome: CeoReport['outcome'] = allApproved ? 'success' : someApproved ? 'partial' : 'failed'

  // Extract deliverables (just the artifact values that exist)
  const keyDeliverables = stages
    .filter((s) => s.artifactValue)
    .map((s) => `Stage ${s.stage} (${s.team}): ${s.artifactValue}`)

  return {
    missionId,
    missionTitle,
    objective,
    outcome,
    revenueImpact: 'See deliverables above', // CEO report contains this in fullReport
    keyDeliverables,
    risksNotes: outcome === 'success' ? [] : ['Some stages did not fully verify — see full report'],
    nextSteps: ['Review the full CEO report', 'Approve mission via dashboard', 'Schedule follow-up mission'],
    fullReport,
    generatedAt: new Date().toISOString(),
  }
}

/**
 * Persist the CEO report to DB (UserSetting) so it survives cold starts.
 */
export async function ceoPersistReport(report: CeoReport): Promise<void> {
  try {
    const user = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
    if (!user) return
    const key = `ceo_report_${report.missionId}`
    const value = JSON.stringify(report)
    // Upsert: try update first, then create
    const existing = await db.userSetting.findFirst({ where: { userId: user.id, key } })
    if (existing) {
      await db.userSetting.update({ where: { id: existing.id }, data: { value } })
    } else {
      await db.userSetting.create({ data: { userId: user.id, key, value } })
    }
  } catch (e: any) {
    console.warn('[ceo-presenter] Failed to persist report:', e?.message?.slice(0, 100))
  }
}

/**
 * Send the CEO report to the owner via Telegram.
 * Plain text — no Markdown (avoids parse errors with _, *, [, ]).
 */
export async function ceoSendTelegram(report: CeoReport): Promise<void> {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return
  try {
    const text = `🎯 MISSION COMPLETE — CEO REPORT\n\n${report.fullReport}\n\n— Agent007 CEO`
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(15000),
    })
  } catch (e: any) {
    console.warn('[ceo-presenter] Telegram failed:', e?.message?.slice(0, 100))
  }
}

/**
 * Send the CEO report via email (if OWNER_EMAIL is set).
 * Best-effort — does not block the mission completion.
 */
export async function ceoSendEmail(report: CeoReport): Promise<void> {
  if (!process.env.OWNER_EMAIL) return
  try {
    // Use the existing email lib if available
    const { sendEmail } = await import('./email')
    await sendEmail({
      to: process.env.OWNER_EMAIL,
      subject: `🎯 Mission Complete: ${report.missionTitle}`,
      body: report.fullReport,
    })
  } catch (e: any) {
    console.warn('[ceo-presenter] Email failed:', e?.message?.slice(0, 100))
  }
}

/**
 * End-to-end: generate the report, persist it, send notifications.
 * Called by mission-pipeline.ts at the end of every mission.
 */
export async function ceoPresentToOwner(opts: {
  missionId: string
  missionTitle: string
  objective: string
  stages: MissionStageSummary[]
}): Promise<CeoReport> {
  const report = await ceoGenerateReport(opts)

  // Run all notifications in parallel — none should block the others
  await Promise.allSettled([
    ceoPersistReport(report),
    ceoSendTelegram(report),
    ceoSendEmail(report),
  ])

  return report
}

/**
 * Load a previously-generated CEO report from DB.
 * Used by the dashboard to render the report.
 */
export async function ceoLoadReport(missionId: string): Promise<CeoReport | null> {
  try {
    const user = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
    if (!user) return null
    const row = await db.userSetting.findFirst({
      where: { userId: user.id, key: `ceo_report_${missionId}` },
    })
    if (!row) return null
    return JSON.parse(row.value) as CeoReport
  } catch {
    return null
  }
}
