/**
 * self-healing-engine.ts — real leader-dispatch resilience.
 *
 * Retries a failing leader dispatch with a same-purpose fallback leader, and falls back to a
 * direct LLM call as an absolute last resort — all within a single dispatch attempt, before the
 * caller ever sees a failure.
 *
 * Deep-audit fix: this file's actual dispatch logic (dispatchWithHealing) previously called
 * dispatchTool('web_search', { query: `${task} ${currentLeader} perspective` }) regardless of
 * which leader was requested — it never dispatched a real leader at all — and had zero callers
 * anywhere in the codebase, so this "self-healing" system never ran; getRecentHealingEvents()
 * (read by the Mission Active dashboard's self-healing tab) was structurally guaranteed to always
 * return an empty list. It's now wired to the real subagent dispatch (runSubagent — the same
 * function mission-supervisor.ts's own leader-execution path uses), and mission-supervisor.ts's
 * runLeader() now calls it instead of runSubagent() directly, so every autonomous mission-stage
 * dispatch gets this retry/fallback layer for free, on the GitHub Actions cron that already runs
 * mission-supervisor every 15 minutes (venture-os-24x7-heartbeat.yml). It's also registered as an
 * on-demand tool (heal_leader_dispatch) so it can be invoked directly mid-conversation.
 *
 * Flow: leader fails -> retry with a same-purpose fallback leader (up to maxRetries total
 * attempts) -> direct LLM call as an absolute last resort -> log the outcome (self_healing_log)
 * for later analysis.
 */

import { db } from './db'
import type { AttachmentMeta, ToolContext, ToolResult } from './tools'
import type { SubagentEventEmit } from './subagents'

export const runtime = 'nodejs'

export type HealStatus = 'success' | 'retried' | 'fallback' | 'failed'

export interface SelfHealResult {
  status: HealStatus
  attempts: number
  leadersTried: string[]
  finalLeader: string | null
  fallbackUsed: boolean
  errors: string[]
  learningStored: boolean
  durationMs: number
  result: { answer: string; steps: Array<{ id: string; toolName?: string }> }
}

// Leader fallback map — if a leader fails, try this same-purpose one next.
const LEADER_FALLBACKS: Record<string, string[]> = {
  scout: ['hunt', 'quantum'],
  aurora: ['quill', 'prism'],
  echo: ['pulse', 'qa_monitor'],
  forge: ['developer', 'trader'],
  quantum: ['scout', 'trader'],
  hunt: ['scout', 'aurora'],
  quill: ['aurora', 'echo'],
  prism: ['aurora', 'quill'],
  pulse: ['echo', 'qa_monitor'],
  vertex: ['forge', 'aurora'],
  legal: ['banker', 'echo'],
  banker: ['legal', 'pulse'],
  trader: ['quantum', 'forge'],
  cybersecurity_a: ['cybersecurity_r', 'developer'],
  cybersecurity_r: ['cybersecurity_a', 'developer'],
  developer: ['forge', 'echo'],
  qa_monitor: ['echo', 'pulse'],
  external_uptime_monitor: ['qa_monitor', 'pulse'],
}

async function getSubagentsModule() { return import('./subagents') }

export interface DispatchWithHealingOptions {
  maxRetries?: number
  timeoutMs?: number
  /** Minimum non-empty answer length to count as a successful dispatch (not a 0-100 score — there's no scoring model behind this). */
  minAnswerLength?: number
  attachments?: AttachmentMeta[]
  language?: 'en' | 'zh'
  parentConversationId?: string
  emit?: SubagentEventEmit
}

/**
 * Execute a leader dispatch with self-healing.
 * If the leader fails (throws, times out, or returns an implausibly short answer), automatically
 * retries with fallback leaders, then falls back to a direct LLM call with no tool access.
 */
export async function dispatchWithHealing(
  leaderId: string,
  task: string,
  options: DispatchWithHealingOptions = {}
): Promise<SelfHealResult> {
  const maxRetries = Math.max(1, Math.min(5, options.maxRetries ?? 3))
  const timeoutMs = Math.max(5000, options.timeoutMs ?? 30000)
  const minAnswerLength = Math.max(1, options.minAnswerLength ?? 40)
  const attachments = options.attachments ?? []
  const language = options.language ?? 'en'
  const parentConversationId = options.parentConversationId ?? `self_heal_${Date.now()}`
  const emit: SubagentEventEmit = options.emit ?? (async () => {})

  const startTime = Date.now()
  const errors: string[] = []
  const leadersTried: string[] = []
  let attempts = 0
  let fallbackUsed = false

  const { getAllSubagents, runSubagent } = await getSubagentsModule()
  const enabledAgents = await getAllSubagents({ includeDisabled: false }).catch(() => [])

  const fallbacks = LEADER_FALLBACKS[leaderId] || ['echo', 'scout']
  const leadersToTry = [leaderId, ...fallbacks].slice(0, maxRetries)

  for (const currentLeader of leadersToTry) {
    attempts++
    leadersTried.push(currentLeader)
    if (currentLeader !== leaderId) {
      fallbackUsed = true
      console.log(`[self-healing] Falling back to leader: ${currentLeader}`)
    }

    const agent = enabledAgents.find((a: any) => a.id === currentLeader)
    if (!agent) {
      errors.push(`${currentLeader}: not an enabled subagent`)
      continue
    }

    try {
      const result = await Promise.race([
        runSubagent({
          subagentId: currentLeader,
          task,
          attachments,
          language,
          emit,
          parentConversationId,
          dispatchId: `self_heal_${currentLeader}_${Date.now()}`,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
        ),
      ])

      if (result.answer && result.answer.trim().length >= minAnswerLength) {
        if (fallbackUsed) await storeLearning(leaderId, currentLeader, task, 'fallback_success', errors)

        return {
          status: fallbackUsed ? 'fallback' : (attempts > 1 ? 'retried' : 'success'),
          attempts,
          leadersTried,
          finalLeader: currentLeader,
          fallbackUsed,
          errors,
          learningStored: fallbackUsed,
          durationMs: Date.now() - startTime,
          result,
        }
      }
      errors.push(`${currentLeader}: answer too short or empty (${result.answer?.length ?? 0} chars)`)
    } catch (e: any) {
      errors.push(`${currentLeader}: ${e?.message?.slice(0, 100) || 'unknown error'}`)
    }

    console.log(`[self-healing] Leader ${currentLeader} failed (attempt ${attempts}/${maxRetries}): ${errors[errors.length - 1]}`)
  }

  // All leaders failed — ultimate fallback: direct LLM call, no tool/leader access.
  console.log('[self-healing] All leaders failed — falling back to direct LLM call')
  try {
    const { callLlmWithRetry } = await import('./agent')
    const completion = await callLlmWithRetry([
      { role: 'system', content: `You are Agent007. A leader dispatch failed and all fallback leaders were exhausted. Handle this task directly, as best you can without tool access: ${task}` },
      { role: 'user', content: task },
    ])
    const answer: string = completion?.choices?.[0]?.message?.content || ''

    await storeLearning(leaderId, 'DIRECT_LLM', task, 'ultimate_fallback', errors)

    return {
      status: 'fallback',
      attempts,
      leadersTried,
      finalLeader: 'DIRECT_LLM',
      fallbackUsed: true,
      errors,
      learningStored: true,
      durationMs: Date.now() - startTime,
      result: { answer, steps: [] },
    }
  } catch (e: any) {
    errors.push(`DIRECT_LLM: ${e?.message?.slice(0, 100) || 'unknown error'}`)
    await storeLearning(leaderId, 'NONE', task, 'complete_failure', errors)

    return {
      status: 'failed',
      attempts,
      leadersTried,
      finalLeader: null,
      fallbackUsed: true,
      errors,
      learningStored: true,
      durationMs: Date.now() - startTime,
      result: { answer: '', steps: [] },
    }
  }
}

/**
 * Store a learning record about a failure + recovery, read back by getRecentHealingEvents()
 * (the Mission Active dashboard's self-healing tab).
 */
async function storeLearning(
  originalLeader: string,
  fallbackLeader: string,
  task: string,
  outcome: string,
  errors: string[]
): Promise<void> {
  try {
    const learning = JSON.stringify({
      timestamp: new Date().toISOString(),
      originalLeader,
      fallbackLeader,
      task: task.slice(0, 200),
      outcome,
      errors: errors.slice(0, 3),
    })

    await db.memory.create({
      data: {
        key: `self_heal_${Date.now()}`,
        value: learning,
        category: 'self_healing_log',
      },
    })
    console.log(`[self-healing] Learning stored: ${originalLeader} → ${fallbackLeader} (${outcome})`)
  } catch (e: any) {
    console.error('[self-healing] Failed to store learning:', e?.message)
  }
}

/**
 * Get recent self-healing events.
 */
export async function getRecentHealingEvents(limit: number = 20): Promise<any[]> {
  try {
    const records = await db.memory.findMany({
      where: { category: 'self_healing_log' },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    return records.map(r => {
      try { return JSON.parse(r.value) }
      catch { return null }
    }).filter(Boolean)
  } catch {
    return []
  }
}

/** On-demand TOOL_REGISTRY entry so this can also be invoked directly mid-conversation. */
export async function toolHealLeaderDispatch(args: { leader_id?: string; task?: string; max_retries?: number }, ctx: ToolContext): Promise<ToolResult> {
  const leaderId = (args.leader_id ?? '').toString().trim()
  const task = (args.task ?? '').toString().trim()
  if (!leaderId || !task) return { ok: false, preview: 'Missing "leader_id" or "task" argument', result: 'Both leader_id and task are required.' }

  const healed = await dispatchWithHealing(leaderId, task, {
    maxRetries: args.max_retries,
    attachments: ctx.attachments,
    language: ctx.language,
    parentConversationId: ctx.conversationId ?? `self_heal_manual_${Date.now()}`,
  })

  const report = `Leader Dispatch Self-Healing\n══════════════════════════════════════════════\nRequested leader: ${leaderId}\nStatus: ${healed.status}\nAttempts: ${healed.attempts} (${healed.leadersTried.join(' → ')})\nFinal leader: ${healed.finalLeader ?? 'none'}\nFallback used: ${healed.fallbackUsed}\nDuration: ${healed.durationMs}ms\n${healed.errors.length > 0 ? `\nERRORS:\n${healed.errors.map(e => `  • ${e}`).join('\n')}\n` : ''}\nRESULT:\n${healed.result.answer || '(empty)'}`

  return {
    ok: healed.status !== 'failed',
    preview: `${healed.status} via ${healed.finalLeader ?? 'none'} (${healed.attempts} attempt${healed.attempts === 1 ? '' : 's'})`,
    result: report,
  }
}
