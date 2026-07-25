/**
 * mission-notifier.ts — UPGRADE #141 (Telegram Milestones — Rec 6)
 * ===================================================================
 * Sends Telegram notifications at every mission milestone:
 *   - Mission started
 *   - Stage started
 *   - Stage approved
 *   - Stage rejected (with reason)
 *   - Stage escalated (max rounds exceeded)
 *   - Mission complete (CEO report)
 *   - Owner approval required
 *
 * Uses PLAIN TEXT (no Markdown) — avoids the parse errors that happen
 * when message text contains _, *, [, ] characters.
 */

/**
 * Send a Telegram notification. Plain text, no Markdown.
 * Best-effort: never throws, never blocks the caller.
 *
 * Requirements:
 *   - TELEGRAM_BOT_TOKEN env var
 *   - TELEGRAM_CHAT_ID env var
 *
 * If either is missing, the function silently returns.
 */
export async function notifyTelegram(message: string): Promise<void> {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    return  // Telegram not configured — silent skip
  }

  // Truncate to Telegram's 4096-char limit (leave room for safety)
  const text = message.length > 4000 ? message.slice(0, 3997) + '...' : message

  try {
    const resp = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_CHAT_ID,
          text,
          disable_web_page_preview: true,
          // NO parse_mode — plain text only
        }),
        signal: AbortSignal.timeout(10000),
      }
    )

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '')
      console.warn(`[mission-notifier] Telegram ${resp.status}: ${errText.slice(0, 100)}`)
    }
  } catch (e: any) {
    console.warn('[mission-notifier] Telegram failed:', e?.message?.slice(0, 100))
  }
}

/**
 * Notify that a mission has started.
 */
export async function notifyMissionStarted(missionId: string, missionTitle: string, pipelineName: string, stageCount: number): Promise<void> {
  await notifyTelegram(
    `🎯 MISSION STARTED\n\n` +
    `Mission: ${missionTitle}\n` +
    `ID: ${missionId}\n` +
    `Pipeline: ${pipelineName}\n` +
    `Stages: ${stageCount}\n\n` +
    `I will update you at every stage. — Agent007`
  )
}

/**
 * Notify that a stage has started.
 */
export async function notifyStageStarted(missionId: string, stage: number, team: string, stageName: string): Promise<void> {
  await notifyTelegram(
    `🚀 STAGE ${stage} STARTED\n\n` +
    `Mission: ${missionId}\n` +
    `Team: ${team}\n` +
    `Stage: ${stageName}\n\n` +
    `Working on it now.`
  )
}

/**
 * Notify that a stage was approved.
 */
export async function notifyStageApproved(missionId: string, stage: number, team: string, score: number, rounds: number): Promise<void> {
  const roundText = rounds === 1 ? 'first round' : `${rounds} rounds`
  await notifyTelegram(
    `✅ STAGE ${stage} APPROVED\n\n` +
    `Mission: ${missionId}\n` +
    `Team: ${team}\n` +
    `Score: ${score}/100\n` +
    `Rounds: ${roundText}\n\n` +
    `Advancing to next stage.`
  )
}

/**
 * Notify that a stage was rejected (will retry).
 */
export async function notifyStageRejected(missionId: string, stage: number, team: string, score: number, round: number, maxRounds: number, correctionsCount: number): Promise<void> {
  await notifyTelegram(
    `⚠️ STAGE ${stage} NEEDS REVISION\n\n` +
    `Mission: ${missionId}\n` +
    `Team: ${team}\n` +
    `Score: ${score}/100\n` +
    `Round: ${round}/${maxRounds}\n` +
    `Corrections: ${correctionsCount}\n\n` +
    `Team will retry with feedback.`
  )
}

/**
 * Notify that a stage was escalated (max rounds exceeded).
 */
export async function notifyStageEscalated(missionId: string, stage: number, team: string, maxRounds: number): Promise<void> {
  await notifyTelegram(
    `❌ STAGE ${stage} ESCALATED\n\n` +
    `Mission: ${missionId}\n` +
    `Team: ${team}\n` +
    `Rounds attempted: ${maxRounds}\n\n` +
    `CEO will note this in the final report.`
  )
}

/**
 * Notify that a mission is complete (with CEO report).
 */
export async function notifyMissionComplete(missionId: string, missionTitle: string, ceoReport: string): Promise<void> {
  await notifyTelegram(
    `🎯 MISSION COMPLETE — CEO REPORT\n\n` +
    `Mission: ${missionTitle}\n` +
    `ID: ${missionId}\n\n` +
    `${ceoReport}\n\n` +
    `— Agent007 CEO`
  )
}

/**
 * Notify that a mission failed.
 */
export async function notifyMissionFailed(missionId: string, reason: string): Promise<void> {
  await notifyTelegram(
    `❌ MISSION FAILED\n\n` +
    `Mission: ${missionId}\n` +
    `Reason: ${reason}\n\n` +
    `Check the dashboard audit trail for details.`
  )
}

/**
 * Notify that owner approval is required (Rec 7).
 */
export async function notifyOwnerApprovalRequired(missionId: string, missionTitle: string, approveCommand: string, rejectCommand: string): Promise<void> {
  await notifyTelegram(
    `⏸️ OWNER APPROVAL REQUIRED\n\n` +
    `Mission: ${missionTitle}\n` +
    `ID: ${missionId}\n\n` +
    `This is a high-stakes mission. Your approval is required before final execution.\n\n` +
    `To APPROVE: reply ${approveCommand}\n` +
    `To REJECT: reply ${rejectCommand}\n\n` +
    `Auto-cancel in 24 hours if no response.`
  )
}
