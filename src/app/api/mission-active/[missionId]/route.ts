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
  const dbMission = await getActiveMissionDB(missionId).catch(() => null)
  if (dbMission) {
    return NextResponse.json({ ok: true, mission: dbMission })
  }
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

  let leaderInfo = await getLeaderForCurrentStageDB(missionId).catch(() => null)
  if (!leaderInfo) {
    leaderInfo = getLeaderForCurrentStage(missionId)
  }
  if (!leaderInfo) {
    return NextResponse.json({ ok: false, error: 'No active leader for this mission' }, { status: 400 })
  }

  await appendLeaderMessageDB(missionId, leaderInfo.leaderId, 'OWNER', message).catch(() => {})
  appendLeaderMessage(missionId, leaderInfo.leaderId, 'OWNER', message)

  let leaderResponse = ''
  const LEADER_TIMEOUT_MS = 45_000

  const dispatchPromise = (async () => {
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
      parentAgentId: getParentId(sub.id) ?? 'vid',
    })
    return result.answer || `[${leaderInfo!.leaderName} returned no response]`
  })()

  const timeoutPromise = new Promise<string>((resolve) => {
    setTimeout(() => {
      resolve(`[${leaderInfo!.leaderName} timed out after 45s.`)
    }, LEADER_TIMEOUT_MS)
  })

  try {
    leaderResponse = await Promise.race([dispatchPromise, timeoutPromise])
  } catch (e: any) {
    leaderResponse = `[${leaderInfo!.leaderName} dispatch failed: ${e?.message?.slice(0, 200) || 'unknown error'}. Check /api/health/llm-providers to see which LLM providers are configured.]`
  }

  const isTimeoutResponse = leaderResponse.includes('timed out after 45s')
  const isDispatchError = leaderResponse.includes('dispatch failed')
  const isUnavailable = leaderResponse.includes('unavailable — no subagent with id')
  const isCeoError = leaderResponse.includes('CEO LLM call failed')
  const isSystemNotice = isTimeoutResponse || isDispatchError || isUnavailable || isCeoError

  if (!isSystemNotice) {
    await appendLeaderMessageDB(missionId, leaderInfo.leaderId, 'LEADER', leaderResponse).catch(() => {})
    appendLeaderMessage(missionId, leaderInfo.leaderId, 'LEADER', leaderResponse)
  }

  return NextResponse.json({
    ok: !isSystemNotice,
    response: leaderResponse,
    leader: leaderInfo,
    missionId,
  })
}
