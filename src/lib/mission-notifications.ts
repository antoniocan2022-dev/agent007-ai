import { db } from './db'
import type { OrchestratorExecutionStatus } from './orchestrator-execution-contract'

export interface MissionOutcomeInput {
  conversationId: string
  content: string
  steps: readonly { toolResult?: { ok: boolean } }[]
  executionStatus?: OrchestratorExecutionStatus
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
 * also a genuine improvement, not just a relocation: when real step outcomes exist (per
 * orchestrator.ts's own `toolResult.ok`), they are now the SOLE authority, not just one input ORed
 * against prose-sniffing -- a governed answer that describes a real failure diplomatically, without
 * the literal words "error/failed/crashed" in its first 50 characters, used to slip through as
 * "mission_complete" even though a tool call underneath it had actually failed, and (the external
 * re-audit that caught this, 2026-09-19) an OR-combination also risked the opposite false positive:
 * a turn where every real tool step succeeded but the narrative's first 50 characters happened to
 * contain one of those words for unrelated reasons (e.g. explaining a PAST error it just resolved)
 * would still have been misclassified mission_failed. Prose-sniffing now only applies when there is
 * no structured execution data to trust instead -- a pure conversational turn with zero tool calls.
 */
// Extracted as its own pure function so the classification logic is directly unit-testable without
// touching the DB/settings/email side effects below.
export function classifyMissionOutcome(content: string, steps: readonly { toolResult?: { ok: boolean } }[], executionStatus?: OrchestratorExecutionStatus): 'mission_complete' | 'mission_failed' {
  if (executionStatus) return executionStatus === 'completed' ? 'mission_complete' : 'mission_failed'
  const looksLikeError = steps.length > 0
    ? steps.some((step) => step.toolResult && step.toolResult.ok === false)
    : /^⚠️|error|failed|crashed/i.test(content.slice(0, 50))
  return looksLikeError ? 'mission_failed' : 'mission_complete'
}

export async function notifyMissionOutcome(input: MissionOutcomeInput): Promise<void> {
  try {
    const { getNotificationSettings, recentlyNotified, getOperatorUserId } = await import('./settings')
    const notif = await getNotificationSettings()
    const eventType = classifyMissionOutcome(input.content, input.steps, input.executionStatus)
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
