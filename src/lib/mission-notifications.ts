import { db } from './db'

export interface MissionOutcomeInput {
  conversationId: string
  content: string
  steps: readonly { toolResult?: { ok: boolean } }[]
}

/**
 * mission-notifications.ts — Phase 3 of the CEO Conversation Kernel migration (making the
 * orchestrator execution-only, 2026-09-19).
 *
 * This "mission complete"/"mission failed" operator email used to live inside orchestrator.ts
 * itself, firing off the orchestrator's own raw, ungoverned narrative -- before route.ts's
 * quality-gated synthesis (tryOperationalDirectResponse / runCeoCognitiveLifecycle) had even run.
 * That meant an operator could receive a "Mission Complete" email previewing text that got
 * immediately overwritten by the governed answer moments later, and orchestrator.ts unilaterally
 * decided the notification was warranted -- one more piece of "final answer" authority living in
 * the execution layer instead of with whichever caller actually owns the governed result.
 *
 * Moved here so every caller (interactive route.ts, the scheduled tick route) fires it from the
 * REAL final content each caller actually settled on, once it has settled on it. looksLikeError is
 * also a genuine improvement, not just a relocation: it now checks real step outcomes (any tool step
 * that actually failed, per orchestrator.ts's own `toolResult.ok`) in addition to the original
 * prose-sniffing heuristic -- a governed answer that describes a real failure diplomatically, without
 * the literal words "error/failed/crashed" in its first 50 characters, used to slip through as
 * "mission_complete" even though a tool call underneath it had actually failed.
 */
// Extracted as its own pure function so the classification logic is directly unit-testable without
// touching the DB/settings/email side effects below -- real step outcomes (any tool that actually
// failed) now feed this alongside the original prose heuristic.
export function classifyMissionOutcome(content: string, steps: readonly { toolResult?: { ok: boolean } }[]): 'mission_complete' | 'mission_failed' {
  const anyStepFailed = steps.some((step) => step.toolResult && step.toolResult.ok === false)
  const looksLikeError = anyStepFailed || /^⚠️|error|failed|crashed/i.test(content.slice(0, 50))
  return looksLikeError ? 'mission_failed' : 'mission_complete'
}

export async function notifyMissionOutcome(input: MissionOutcomeInput): Promise<void> {
  try {
    const { getNotificationSettings, recentlyNotified, getOperatorUserId } = await import('./settings')
    const notif = await getNotificationSettings()
    const eventType = classifyMissionOutcome(input.content, input.steps)
    const looksLikeError = eventType === 'mission_failed'
    if (!notif.enabled || !notif.events[eventType as keyof typeof notif.events]) return
    if (await recentlyNotified(eventType, notif.minDelayMinutes)) return
    const conversation = await db.conversation.findUnique({ where: { id: input.conversationId }, select: { title: true } }).catch(() => null)
    const convTitle = conversation?.title ?? 'Mission'
    const preview = input.content.slice(0, 500)
    const { sendEmail } = await import('./email')
    const userId = await getOperatorUserId()
    sendEmail({
      to: notif.email,
      subject: looksLikeError ? `Mission Failed: ${convTitle}` : `Mission Complete: ${convTitle}`,
      body: looksLikeError
        ? `Agent007 encountered an issue while running a mission.\n\nConversation: ${convTitle}\n\nPreview:\n${preview}\n\nOpen the dashboard at / to investigate.`
        : `Agent007 has completed a mission.\n\nConversation: ${convTitle}\n\nResult preview:\n${preview}\n\nOpen the dashboard at / to view the full report.`,
      userId: userId ?? undefined,
      type: eventType,
    }).catch(() => {})
  } catch {
    /* ignore notification errors -- never block a response on a notification failure */
  }
}
