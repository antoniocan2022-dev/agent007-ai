/**
 * /api/mission-active/[missionId] — UPGRADE #111 + #115 + #143
 * Per-mission detail + owner↔leader chat.
 *
 * GET  /api/mission-active/[missionId]              — get mission detail
 * POST /api/mission-active/[missionId]?action=ask   — owner asks the current stage leader a question { message }
 *                                                       The leader subagent is dispatched and the response is appended to the thread.
 *
 * UPGRADE #115 — Hard timeout (45s) on leader dispatch.
 * UPGRADE #143 — Reads/writes via DB-persisted store (active-missions-db.ts).
 *               Previously used in-memory store which lost leader messages
 *               across Vercel cold starts.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { getActiveMission, appendLeaderMessage, getLeaderForCurrentStage } from '@/lib/active-missions'
import {
  getActiveMissionDB,
  appendLeaderMessageDB,
  getLeaderForCurrentStageDB,
} from '@/lib/active-missions-db'
import { runSubagent, getAllSubagents } from '@/lib/subagents'
import { getParentId } from '@/lib/hierarchy-control'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ missionId: string }> }
) {
  const { missionId } = await params
  // UPGRADE #143 — Try DB first (survives cold starts)
  const dbMission = await getActiveMissionDB(missionId).catch(() => null)
  if (dbMission) {
    return NextResponse.json({ ok: true, mission: dbMission })
  }
  // Fallback to in-memory (first-run seeds)
  const mission = getActiveMission(missionId)
  if (!mission) {
    return NextResponse.json({ ok: false, error: 'Mission not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, mission })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ missionId: string }> }
) {
  const session = await getServerSession()
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const { missionId } = await params
  const url = new URL(req.url)
  const action = url.searchParams.get('action') ?? 'ask'
  const body = await req.json().catch(() => ({}))

  // UPGRADE #143 — Load from DB first
  let mission = await getActiveMissionDB(missionId).catch(() => null)
  if (!mission) {
    mission = getActiveMission(missionId) as any
  }
  if (!mission) {
    return NextResponse.json({ ok: false, error: 'Mission not found' }, { status: 404 })
  }

  if (action !== 'ask') {
    return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 })
  }

  const message = (body.message || '').toString().trim()
  if (!message) {
    return NextResponse.json({ ok: false, error: 'message required' }, { status: 400 })
  }

  // Find the leader currently in charge
  let leaderInfo = await getLeaderForCurrentStageDB(missionId).catch(() => null)
  if (!leaderInfo) {
    leaderInfo = getLeaderForCurrentStage(missionId)
  }
  if (!leaderInfo) {
    return NextResponse.json({ ok: false, error: 'No active leader for this mission' }, { status: 400 })
  }

  // UPGRADE #143 — Persist the owner's question to DB
  await appendLeaderMessageDB(missionId, leaderInfo.leaderId, 'OWNER', message).catch(() => {})
  // Also mirror to in-memory store (for backward compat with any callers that read it)
  appendLeaderMessage(missionId, leaderInfo.leaderId, 'OWNER', message)

  // UPGRADE #115 — Wrap leader dispatch in a hard 45s timeout.
  let leaderResponse = ''
  const LEADER_TIMEOUT_MS = 45_000

  const dispatchPromise = (async () => {
    // UPGRADE #148 (Issue 3c fix) — Special-case the CEO stage.
    // The CEO is not a subagent — it's the apex LLM that aggregates everything
    // into an executive report. Before: trying to find a 'ceo' subagent always
    // failed with "unavailable" because no such subagent exists. After: route
    // CEO questions directly through callLlmWithRetry with the CEO system prompt.
    if (leaderInfo!.leaderId === 'ceo' || leaderInfo!.leaderName.toLowerCase() === 'ceo') {
      try {
        const { callLlmWithRetry } = await import('@/lib/agent')
        const ceoResponse = await callLlmWithRetry([
          {
            role: 'system',
            content: `You are the CEO of Agent007 — the apex executive reporting to the human owner (Antonio).

The owner has asked you a direct question about a mission in progress. Respond as the CEO:
1. Be concise (max 300 words)
2. Give a direct, executive-level answer
3. If the question is about status, summarize what's done + what's pending + risks
4. If the question is about a decision, give a clear recommendation with rationale
5. Be honest — if something is broken or blocked, say so`
          },
          {
            role: 'user',
            content: `[OWNER DIRECT QUESTION — Mission: ${mission!.title}]

Mission context:
- Title: ${mission!.title}
- Description: ${mission!.description}
- Current stage: ${leaderInfo!.stage}
- Revenue target: $${mission!.revenueTarget}/month

Chain so far:
${mission!.chain.map((c) => `  • ${c.stage} → ${c.leader} (${c.status})`).join('\n')}

Owner's question:
${message}

Respond as the CEO.`
          }
        ], { thinking: false })

        return typeof ceoResponse === 'string'
          ? ceoResponse
          : (ceoResponse?.content ?? ceoResponse?.message?.content ?? '[CEO produced no output]')
      } catch (ceoErr: any) {
        return `[CEO LLM call failed: ${ceoErr?.message?.slice(0, 200) ?? 'unknown error'}. Check /api/health/llm-providers for live provider status.]`
      }
    }

    const allSubs = await getAllSubagents({ includeDisabled: false })

    // UPGRADE #148 (Issue 3a fix) — Strict id-based matching only.
    // Before: 3-way OR with fuzzy name matching:
    //   s.id === leaderId || s.name === leaderName || s.name.includes(leaderName.split(' ')[0])
    // The name-based fallbacks caused two real bugs:
    //   (1) 'Cybersecurity R' leaderName matched BOTH 'Cybersecurity A' AND
    //       'Cybersecurity R' subagents (first wins) — wrong agent dispatched.
    //   (2) 'revenue' pod leaderName 'QUANTUM + AURORA' matched QUANTUM
    //       (incorrect — revenue is a 2-agent pod with no single subagent).
    // After: id-only match. If no agent has the exact id, return a clear
    // error so the owner knows to fix POD_LEADERS rather than seeing a
    // wrong agent respond.
    const sub = allSubs.find((s: any) => s.id === leaderInfo!.leaderId)

    if (!sub) {
      return `[${leaderInfo!.leaderName} unavailable — no subagent with id '${leaderInfo!.leaderId}' in the registry.

This usually means POD_LEADERS (in src/lib/active-missions.ts) is out of sync with SUBAGENTS (in src/lib/subagents.ts). The leaderId must match a subagent id exactly.

Available subagent ids: ${allSubs.map((s: any) => s.id).slice(0, 20).join(', ')}${allSubs.length > 20 ? ` (... +${allSubs.length - 20} more)` : ''}

You can still ask the Super Agent about this mission from the main chat.]`
    }

    const task = `[OWNER DIRECT QUESTION — Mission: ${mission!.title}]

Mission context:
- Title: ${mission!.title}
- Description: ${mission!.description}
- Current stage: ${leaderInfo!.stage}
- Revenue target: $${mission!.revenueTarget}/month
- Priority: ${mission!.priority}
- Category: ${mission!.category}

Chain so far:
${mission!.chain.map((c) => `  • ${c.stage} → ${c.leader} (${c.status})`).join('\n')}

Owner's question:
${message}

Respond as the LEADER currently in charge of the ${leaderInfo!.stage} stage. Give a direct, concrete status update:
1. What has your team accomplished so far for this mission
2. What you are working on right now
3. Blockers / risks if any
4. Estimated time to complete this stage and hand off to the next team
5. Anything the owner needs to decide or provide

Be concise (max 300 words) and actionable. Do NOT call any tools — just give a status update from your team's perspective.`

    const result = await runSubagent({
      subagentId: sub.id,
      task,
      dispatchId: `mission_ask_${Date.now()}`,
      attachments: [],
      language: 'en',
      emit: async () => {},
      parentConversationId: `mission_${missionId}`,
      parentAgentId: getParentId(leaderInfo.leaderId) ?? 'vid',
      missionId,
    })
    return result.answer || `[${leaderInfo!.leaderName} returned no response]`
  })()

  const timeoutPromise = new Promise<string>((resolve) => {
    setTimeout(() => {
      resolve(`[${leaderInfo!.leaderName} timed out after 45s.

This means all LLM providers failed or were rate-limited. To diagnose:

1. Open /api/health/llm-providers in your browser (sign in first)
2. Check the "activeChain" field — if it's empty, NO providers will run
3. Check "skippedProviders" — these are misconfigured (missing API key, wrong base URL, etc.)
4. Add the missing API keys in Vercel → Settings → Environment Variables
5. Common providers to enable: MISTRAL_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, CEREBRAS_API_KEY

Your message has been logged to the audit trail. Once a provider is configured, ask again or wait for the next mission tick.]`)
    }, LEADER_TIMEOUT_MS)
  })

  try {
    leaderResponse = await Promise.race([dispatchPromise, timeoutPromise])
  } catch (e: any) {
    leaderResponse = `[${leaderInfo!.leaderName} dispatch failed: ${e?.message?.slice(0, 200) || 'unknown error'}. Check /api/health/llm-providers to see which LLM providers are configured.]`
  }

  // UPGRADE #146 (Warning fix) — Don't persist timeout/error responses to DB
  // as if they were real leader messages. They're system notices, not leader
  // replies. Mark them clearly so the dashboard can render them differently.
  // UPGRADE #148 — updated detection patterns to match the new detailed messages.
  const isTimeoutResponse = leaderResponse.includes('timed out after 45s')
  const isDispatchError = leaderResponse.includes('dispatch failed')
  const isUnavailable = leaderResponse.includes('unavailable — no subagent with id')
  const isCeoError = leaderResponse.includes('CEO LLM call failed')
  const isSystemNotice = isTimeoutResponse || isDispatchError || isUnavailable || isCeoError

  // UPGRADE #143 — Persist the leader's response to DB (survives cold starts!)
  // Only persist if it's a REAL leader response, not a system timeout/error notice.
  if (!isSystemNotice) {
    await appendLeaderMessageDB(missionId, leaderInfo.leaderId, leaderInfo.leaderName, leaderResponse).catch(() => {})
    appendLeaderMessage(missionId, leaderInfo.leaderId, leaderInfo.leaderName, leaderResponse)
  }

  return NextResponse.json({
    ok: !isSystemNotice,
    response: leaderResponse,
    leader: leaderInfo,
    missionId,
    systemNotice: isSystemNotice,
  })
}
