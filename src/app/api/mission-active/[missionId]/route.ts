import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { assertDelegationAllowed, authorityLevelFor } from '@/lib/architecture-control-plane'
import { getActiveMissionDB, appendLeaderMessageDB, getLeaderForCurrentStageDB } from '@/lib/active-missions-db'
import { runSubagent, getAllSubagents } from '@/lib/subagents'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function errorResponse(error: unknown, status = 400) {
  return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status })
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ missionId: string }> }) {
  const session = await getServerSession()
  if (!session?.user) return errorResponse('Unauthorized', 401)
  const { missionId } = await params
  try {
    const mission = await getActiveMissionDB(missionId)
    if (!mission) return errorResponse('Mission not found', 404)
    return NextResponse.json({ ok: true, mission })
  } catch (error) {
    return errorResponse(error, 503)
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ missionId: string }> }) {
  const session = await getServerSession()
  if (!session?.user) return errorResponse('Unauthorized', 401)
  const { missionId } = await params
  const action = new URL(req.url).searchParams.get('action') ?? 'ask'
  const body = await req.json().catch(() => ({}))
  if (action !== 'ask') return errorResponse(`Unknown action: ${action}`)
  const message = String(body.message ?? '').trim()
  if (!message) return errorResponse('message required')

  try {
    const mission = await getActiveMissionDB(missionId)
    if (!mission) return errorResponse('Mission not found', 404)
    const leaderInfo = await getLeaderForCurrentStageDB(missionId)
    if (!leaderInfo) return errorResponse('No active leader for this mission')

    // Mission communication follows the same hierarchy as execution:
    // CEO → VID → current mission leader. The human owner is authenticated
    // outside this agent hierarchy and cannot forge an agent identity.
    const targetLevel = authorityLevelFor(leaderInfo.leaderId)
    if (targetLevel !== 'LEADER') return errorResponse(`Current mission owner ${leaderInfo.leaderId} is not a registered leader.`)
    assertDelegationAllowed({ actorId: 'agent007', actorLevel: 'CEO', targetId: 'vid', targetLevel: 'VID' })
    assertDelegationAllowed({ actorId: 'vid', actorLevel: 'VID', targetId: leaderInfo.leaderId, targetLevel: 'LEADER', delegatedBy: 'agent007' })

    await appendLeaderMessageDB(missionId, leaderInfo.leaderId, 'OWNER', message)

    const dispatchPromise = (async () => {
      if (leaderInfo.leaderId === 'ceo' || leaderInfo.leaderName.toLowerCase() === 'ceo') {
        const { callLlmWithRetry } = await import('@/lib/agent')
        const response = await callLlmWithRetry([
          { role: 'system', content: 'You are the CEO of Agent007. Answer the owner about the mission concisely and honestly. Report status, blockers, risks, and decisions without inventing progress.' },
          { role: 'user', content: `[MISSION ${mission.id}] ${mission.title}\nStage: ${leaderInfo.stage}\nDescription: ${mission.description}\nOwner question: ${message}` },
        ], { thinking: false })
        return typeof response === 'string' ? response : response?.content ?? response?.message?.content ?? '[CEO produced no output]'
      }

      const sub = (await getAllSubagents({ includeDisabled: false })).find((candidate: any) => candidate.id === leaderInfo.leaderId)
      if (!sub) throw new Error(`No subagent with leader id '${leaderInfo.leaderId}'.`)
      const task = `[OWNER QUESTION — Mission ${mission.id}]\nTitle: ${mission.title}\nStage: ${leaderInfo.stage}\nDescription: ${mission.description}\nOwner question: ${message}\nRespond as the current mission leader. State accomplishments, current work, blockers, and next handoff. Never claim an artifact or outcome that is not present in the mission record.`
      const result = await runSubagent({ subagentId: sub.id, task, dispatchId: `mission_ask_${Date.now()}`, attachments: [], language: 'en', emit: async () => {}, parentConversationId: `mission_${missionId}` })
      return result.answer || `[${leaderInfo.leaderName} returned no response]`
    })()

    const timeout = new Promise<string>((resolve) => setTimeout(() => resolve(`[${leaderInfo.leaderName} timed out after 45s. The request remains logged and can be retried after LLM provider recovery.]`), 45_000))
    const leaderResponse = await Promise.race([dispatchPromise, timeout])
    const isSystemNotice = leaderResponse.includes('timed out after 45s.') || leaderResponse.startsWith('[CEO LLM call failed')
    if (!isSystemNotice) await appendLeaderMessageDB(missionId, leaderInfo.leaderId, 'LEADER', leaderResponse)

    const updated = await getActiveMissionDB(missionId)
    return NextResponse.json({ ok: true, mission: updated, leaderResponse, isSystemNotice })
  } catch (error) {
    return errorResponse(error, 400)
  }
}
