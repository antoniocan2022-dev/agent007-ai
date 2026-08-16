import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { assertMissionTransition, buildArtifactId, registerArtifact } from '@/lib/architecture-control-plane'
import { verifyCanonicalArtifact } from '@/lib/artifact-verifier'
import { createActiveMissionDB, getActiveMissionDB, listActiveMissionsDB, saveActiveMissionDB } from '@/lib/active-missions-db'
import { STAGE_ORDER } from '@/lib/active-missions'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function fail(error: unknown, status = 400) {
  return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status })
}

export async function GET() {
  const session = await getServerSession()
  if (!session?.user) return fail('Unauthorized', 401)
  try {
    const missions = await listActiveMissionsDB()
    return NextResponse.json({ ok: true, count: missions.length, missions })
  } catch (error) {
    // Never fall back to synthetic/in-memory mission state in production.
    return fail(error, 503)
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user) return fail('Unauthorized', 401)
  const url = new URL(req.url)
  const action = url.searchParams.get('action') ?? 'create'
  const body = await req.json().catch(() => ({}))

  try {
    if (action === 'create') {
      if (typeof body.title !== 'string' || typeof body.description !== 'string' || !body.title.trim() || !body.description.trim()) return fail('title and description required')
      const mission = await createActiveMissionDB({
        title: body.title.trim(), description: body.description.trim(), revenueTarget: Number(body.revenueTarget) || 0,
        priority: body.priority, category: body.category,
      })
      if (!mission) return fail('Mission persistence unavailable.', 503)
      return NextResponse.json({ ok: true, mission })
    }

    if (!body.missionId || typeof body.missionId !== 'string') return fail('missionId required')
    const mission = await getActiveMissionDB(body.missionId)
    if (!mission) return fail('Mission not found', 404)
    const handoff = mission.chain.find((c) => c.stage === mission.currentStage)

    if (action === 'advance') {
      if (!handoff) return fail(`Mission ${mission.id} has no handoff for current stage ${mission.currentStage}.`)
      if (handoff.artifactRequired !== 'none') {
        if (!handoff.artifactValue) return fail(`Advancement blocked: ${handoff.stage} requires a ${handoff.artifactRequired} artifact.`)
        if (!handoff.artifactVerified) return fail(`Advancement blocked: artifact for ${handoff.stage} is not verified.`)
      }
      const currentIndex = STAGE_ORDER.indexOf(mission.currentStage)
      if (currentIndex < 0 || currentIndex >= STAGE_ORDER.length - 1) return NextResponse.json({ ok: true, mission })
      const nextStage = STAGE_ORDER[currentIndex + 1]
      assertMissionTransition(mission.currentStage, nextStage)
      handoff.status = 'done'
      handoff.completedAt = new Date().toISOString()
      mission.currentStage = nextStage
      const next = mission.chain.find((c) => c.stage === nextStage)
      if (next) {
        next.status = 'active'
        next.startedAt = new Date().toISOString()
      }
      mission.updatedAt = new Date().toISOString()
      mission.log.push({ timestamp: mission.updatedAt, actor: session.user.email ?? 'OWNER', stage: nextStage, message: `Stage advanced ${handoff.stage} → ${nextStage}.` })
      await saveActiveMissionDB(mission)
      return NextResponse.json({ ok: true, mission })
    }

    if (action === 'approve') {
      if (mission.currentStage !== 'OWNER_APPROVAL') return fail(`Owner approval is only valid from OWNER_APPROVAL; current state is ${mission.currentStage}.`)
      assertMissionTransition(mission.currentStage, 'COMPLETED')
      if (handoff) {
        handoff.status = 'done'
        handoff.completedAt = new Date().toISOString()
        handoff.notes = 'Owner approved. Mission complete.'
      }
      mission.currentStage = 'COMPLETED'
      mission.updatedAt = new Date().toISOString()
      mission.log.push({ timestamp: mission.updatedAt, actor: 'OWNER', stage: 'COMPLETED', message: 'Owner approved the mission. Marked COMPLETED.' })
      await saveActiveMissionDB(mission)
      return NextResponse.json({ ok: true, mission })
    }

    if (action === 'set-artifact') {
      if (typeof body.artifactValue !== 'string' || !body.artifactValue.trim()) return fail('artifactValue required')
      if (!handoff) return fail('Current mission stage has no handoff.')
      if (handoff.artifactRequired === 'none') return fail('Current stage does not accept an artifact.')
      // Critical rule: clients can PRODUCE artifacts, but cannot self-assert verification.
      const artifact = await registerArtifact({
        artifactId: buildArtifactId({ ventureId: body.ventureId ?? null, missionId: mission.id, stage: mission.currentStage, artifactType: handoff.artifactRequired, value: body.artifactValue.trim() }),
        ventureId: body.ventureId ?? null,
        missionId: mission.id,
        stage: mission.currentStage,
        producer: session.user.email ?? 'OWNER',
        consumers: [],
        artifactType: handoff.artifactRequired,
        value: body.artifactValue.trim(),
        version: 1,
        supersedes: null,
      })
      handoff.artifactValue = artifact.value
      handoff.artifactVerified = artifact.status === 'VERIFIED'
      handoff.artifactVerifiedAt = artifact.verifiedAt
      handoff.artifactVerifyError = null
      handoff.status = 'active'
      mission.updatedAt = new Date().toISOString()
      await saveActiveMissionDB(mission)
      return NextResponse.json({ ok: true, mission, artifact, verified: false })
    }

    if (action === 'verify-artifact') {
      if (!handoff?.artifactValue) return fail('No artifact is registered for the current stage.')
      const artifactId = buildArtifactId({ ventureId: body.ventureId ?? null, missionId: mission.id, stage: mission.currentStage, artifactType: handoff.artifactRequired, value: handoff.artifactValue })
      const result = await verifyCanonicalArtifact(artifactId, session.user.email ?? 'OWNER', { ventureId: body.ventureId ?? null, missionId: mission.id, stage: mission.currentStage })
      handoff.artifactVerified = result.verified
      handoff.artifactVerifiedAt = result.verified ? new Date().toISOString() : null
      handoff.artifactVerifyError = result.verified ? null : result.reason
      if (result.verified) handoff.status = 'active'
      mission.updatedAt = new Date().toISOString()
      await saveActiveMissionDB(mission)
      return NextResponse.json({ ok: result.verified, mission, artifact: result.artifact, reason: result.reason }, { status: result.verified ? 200 : 409 })
    }

    return fail(`Unknown action: ${action}`)
  } catch (error) {
    return fail(error, 400)
  }
}
