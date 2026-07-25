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
    const allSubs = await getAllSubagents({ includeDisabled: false })
    const sub = allSubs.find((s: any) =>
      s.id === leaderInfo!.leaderId ||
      s.name.toLowerCase() === leaderInfo!.leaderName.toLowerCase() ||
      s.name.toLowerCase().includes(leaderInfo!.leaderName.toLowerCase().split(' ')[0])
    )

    if (!sub) {
      return `[${leaderInfo!.leaderName} unavailable — subagent not found in registry. The mission stage is still tracked; you can dispatch via the main chat if needed.]`
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
    })
    return result.answer || `[${leaderInfo!.leaderName} returned no response]`
  })()

  const timeoutPromise = new Promise<string>((resolve) => {
    setTimeout(() => {
      resolve(`[${leaderInfo!.leaderName} timed out after 45s. This usually means all LLM providers are misconfigured or rate-limited. Check /api/health/llm-providers for live status. Your message has been logged and the leader will respond on the next mission tick.]`)
    }, LEADER_TIMEOUT_MS)
  })

  try {
    leaderResponse = await Promise.race([dispatchPromise, timeoutPromise])
  } catch (e: any) {
    leaderResponse = `[${leaderInfo!.leaderName} dispatch failed: ${e?.message?.slice(0, 200) || 'unknown error'}. Check /api/health/llm-providers to see which LLM providers are configured.]`
  }

  // UPGRADE #143 — Persist the leader's response to DB (survives cold starts!)
  await appendLeaderMessageDB(missionId, leaderInfo.leaderId, 'LEADER', leaderResponse).catch(() => {})
  appendLeaderMessage(missionId, leaderInfo.leaderId, 'LEADER', leaderResponse)

  // Return the full updated mission so the UI can re-render
  const updated = await getActiveMissionDB(missionId).catch(() => null) ?? getActiveMission(missionId)
  return NextResponse.json({
    ok: true,
    mission: updated,
    leaderResponse,
  })
}

