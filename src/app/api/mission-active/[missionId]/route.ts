/**
 * /api/mission-active/[missionId] — UPGRADE #111
 * Per-mission detail + owner↔leader chat.
 *
 * GET  /api/mission-active/[missionId]              — get mission detail
 * POST /api/mission-active/[missionId]?action=ask   — owner asks the current stage leader a question { message }
 *                                                       The leader subagent is dispatched and the response is appended to the thread.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { getActiveMission, appendLeaderMessage, getLeaderForCurrentStage } from '@/lib/active-missions'
import { runSubagent, getAllSubagents } from '@/lib/subagents'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ missionId: string }> }
) {
  const { missionId } = await params
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

  const mission = getActiveMission(missionId)
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
  const leaderInfo = getLeaderForCurrentStage(missionId)
  if (!leaderInfo) {
    return NextResponse.json({ ok: false, error: 'No active leader for this mission' }, { status: 400 })
  }

  // Persist the owner's question
  appendLeaderMessage(missionId, leaderInfo.leaderId, 'OWNER', message)

  // Dispatch the question to the leader subagent
  let leaderResponse = ''
  try {
    const allSubs = await getAllSubagents({ includeDisabled: false })
    const sub = allSubs.find((s: any) =>
      s.id === leaderInfo.leaderId ||
      s.name.toLowerCase() === leaderInfo.leaderName.toLowerCase() ||
      s.name.toLowerCase().includes(leaderInfo.leaderName.toLowerCase().split(' ')[0])
    )

    if (!sub) {
      leaderResponse = `[${leaderInfo.leaderName} unavailable — subagent not found in registry. Stage ${leaderInfo.stage} remains in progress. Log a fallback response via the orchestrator.]`
    } else {
      const task = `[OWNER DIRECT QUESTION — Mission: ${mission.title}]

Mission context:
- Title: ${mission.title}
- Description: ${mission.description}
- Current stage: ${leaderInfo.stage}
- Revenue target: $${mission.revenueTarget}/month
- Priority: ${mission.priority}
- Category: ${mission.category}

Chain so far:
${mission.chain.map((c) => `  • ${c.stage} → ${c.leader} (${c.status})`).join('\n')}

Owner's question:
${message}

Respond as the LEADER currently in charge of the ${leaderInfo.stage} stage. Give a direct, concrete status update:
1. What has your team accomplished so far for this mission
2. What you are working on right now
3. Blockers / risks if any
4. Estimated time to complete this stage and hand off to the next team
5. Anything the owner needs to decide or provide

Be concise (max 300 words) and actionable.`

      const result = await runSubagent({
        subagentId: sub.id,
        task,
        dispatchId: `mission_ask_${Date.now()}`,
        attachments: [],
        language: 'en',
        emit: async () => {},
        parentConversationId: `mission_${missionId}`,
      })
      leaderResponse = result.answer || `[${leaderInfo.leaderName} returned no response]`
    }
  } catch (e: any) {
    leaderResponse = `[${leaderInfo.leaderName} dispatch failed: ${e?.message?.slice(0, 120) || 'unknown error'}]`
  }

  // Persist the leader's response
  appendLeaderMessage(missionId, leaderInfo.leaderId, 'LEADER', leaderResponse)

  // Return the full updated mission so the UI can re-render
  const updated = getActiveMission(missionId)
  return NextResponse.json({
    ok: true,
    mission: updated,
    leaderResponse,
  })
}
