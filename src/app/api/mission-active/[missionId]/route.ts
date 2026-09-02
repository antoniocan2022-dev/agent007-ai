import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { assertDelegationAllowed, authorityLevelFor } from '@/lib/architecture-control-plane'
import { getActiveMissionDB, appendLeaderMessageDB, getLeaderForCurrentStageDB } from '@/lib/active-missions-db'
import { getAllSubagents, runSubagent } from '@/lib/subagents'
import { runCeoCognitiveLifecycle } from '@/lib/ceo-cognitive-lifecycle'
import { resolveMissionOwnerId } from '@/lib/mission-owner'

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
    const ownerId = await resolveMissionOwnerId(session.user)
    const mission = await getActiveMissionDB(missionId, ownerId)
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
    const ownerId = await resolveMissionOwnerId(session.user)
    const mission = await getActiveMissionDB(missionId, ownerId)
    if (!mission) return errorResponse('Mission not found', 404)
    const leaderInfo = await getLeaderForCurrentStageDB(missionId, ownerId)
    if (!leaderInfo) return errorResponse('No active leader for this mission')

    const targetLevel = authorityLevelFor(leaderInfo.leaderId)
    if (targetLevel !== 'LEADER') return errorResponse(`Current mission owner ${leaderInfo.leaderId} is not a registered leader.`)
    assertDelegationAllowed({ actorId: 'agent007', actorLevel: 'CEO', targetId: 'vid', targetLevel: 'VID' })
    assertDelegationAllowed({ actorId: 'vid', actorLevel: 'VID', targetId: leaderInfo.leaderId, targetLevel: 'LEADER', delegatedBy: 'agent007' })

    await appendLeaderMessageDB(missionId, leaderInfo.leaderId, 'OWNER', message, ownerId)

    const dispatchPromise = (async () => {
      if (leaderInfo.leaderId === 'ceo' || leaderInfo.leaderName.toLowerCase() === 'ceo') {
        const contextualEvidence = [
          `Mission ID: ${mission.id}`,
          `Mission owner: ${mission.ownerId ?? ownerId}`,
          `Mission title: ${mission.title}`,
          `Mission stage: ${leaderInfo.stage}`,
          `Mission description: ${mission.description}`,
        ].join('\n')
        return runCeoCognitiveLifecycle({
          missionId,
          contextualEvidence,
          verification: 'enhanced',
          messages: [
            { role: 'system', content: 'You are the CEO of Agent007. Answer the owner about the mission concisely and honestly. Report status, blockers, risks, and decisions without inventing progress.' },
            { role: 'user', content: `[MISSION ${mission.id}] ${mission.title}\nStage: ${leaderInfo.stage}\nDescription: ${mission.description}\nOwner question: ${message}` },
          ],
          timeoutMs: 55000,
        })
      }

      const sub = (await getAllSubagents({ includeDisabled: false })).find((candidate: any) => candidate.id === leaderInfo.leaderId)
      if (!sub) throw new Error(`No subagent with leader id '${leaderInfo.leaderId}'.`)
      const task = `[OWNER QUESTION — Mission ${mission.id}]\nTitle: ${mission.title}\nStage: ${leaderInfo.stage}\nDescription: ${mission.description}\nOwner question: ${message}\nRespond as the current mission leader. State accomplishments, current work, blockers, and next handoff. Never claim an artifact or outcome that is not present in the mission record.`
      const result = await runSubagent({ subagentId: sub.id, task, dispatchId: `mission_ask_${Date.now()}`, attachments: [], language: 'en', emit: async () => {}, parentConversationId: `mission_${missionId}` })
      return result.answer || `[${leaderInfo.leaderName} returned no response]`
    })()

    const timeout = new Promise<any>((resolve) => setTimeout(() => resolve({ content: `[${leaderInfo.leaderName} timed out after 45s. The request remains logged and can be retried after LLM provider recovery.]`, degraded: true }), 45_000))
    const leaderResult = await Promise.race([dispatchPromise, timeout])
    const leaderResponse = typeof leaderResult === 'string' ? leaderResult : leaderResult?.content ?? leaderResult?.answer ?? `[${leaderInfo.leaderName} returned no response]`
    const isSystemNotice = leaderResponse.includes('timed out after 45s.') || (typeof leaderResult === 'object' && leaderResult?.evidenceState === 'UNAVAILABLE')
    if (!isSystemNotice) await appendLeaderMessageDB(missionId, leaderInfo.leaderId, 'LEADER', leaderResponse, ownerId)

    const updated = await getActiveMissionDB(missionId, ownerId)
    return NextResponse.json({ ok: true, mission: updated, leaderResponse, isSystemNotice, lifecycle: typeof leaderResult === 'object' && leaderResult ? { decisionPlan: leaderResult.decisionPlan, executionPlan: leaderResult.executionPlan, evidenceState: leaderResult.evidenceState, quality: leaderResult.quality, provider: leaderResult.provider, model: leaderResult.model } : undefined })
  } catch (error) {
    return errorResponse(error, 400)
  }
}
