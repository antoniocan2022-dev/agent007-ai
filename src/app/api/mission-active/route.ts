/**
 * /api/mission-active — UPGRADE #111 + #120 + #143
 * List active missions with team-chain state.
 *
 * GET  /api/mission-active                       — list all active missions
 * POST /api/mission-active                       — create new mission { title, description, revenueTarget, priority, category }
 * POST /api/mission-active?action=advance        — advance a mission to next stage { missionId } (BLOCKED if artifact not verified)
 * POST /api/mission-active?action=approve        — owner approves mission { missionId }
 * POST /api/mission-active?action=set-artifact   — set artifact for current stage { missionId, artifactValue }
 * POST /api/mission-active?action=verify-artifact — verify artifact for current stage { missionId }
 *
 * UPGRADE #143 — All reads/writes now go through DB-persisted store
 * (active-missions-db.ts). Previously used in-memory store which lost
 * leader messages on every Vercel cold start.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import {
  listActiveMissions,
  createActiveMission,
  advanceMissionStage,
  setStageArtifact,
  approveMission,
} from '@/lib/active-missions'
import {
  listActiveMissionsDB,
  getActiveMissionDB,
  createActiveMissionDB,
  saveActiveMissionDB,
} from '@/lib/active-missions-db'
import { verifyStageArtifact } from '@/lib/active-missions'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  // UPGRADE #143 — Try DB first; fall back to in-memory seeds for first-run UX.
  try {
    const dbMissions = await listActiveMissionsDB()
    if (dbMissions.length > 0) {
      return NextResponse.json({ ok: true, count: dbMissions.length, missions: dbMissions })
    }
  } catch (e: any) {
    console.warn('[mission-active GET] DB list failed, falling back to in-memory:', e?.message?.slice(0, 80))
  }
  // First-run fallback: in-memory seeds (these will be persisted on next create)
  const missions = listActiveMissions()
  return NextResponse.json({ ok: true, count: missions.length, missions })
}

export async function POST(req: NextRequest) {
  // Auth: only owner can create / advance / approve
  const session = await getServerSession()
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const action = url.searchParams.get('action') ?? 'create'
  const body = await req.json().catch(() => ({}))

  if (action === 'create') {
    if (!body.title || !body.description) {
      return NextResponse.json({ ok: false, error: 'title and description required' }, { status: 400 })
    }
    // UPGRADE #143 — Create in DB (persists across cold starts)
    const dbMission = await createActiveMissionDB({
      title: body.title,
      description: body.description,
      revenueTarget: Number(body.revenueTarget) || 0,
      priority: body.priority,
      category: body.category,
    }).catch(() => null)
    if (dbMission) {
      return NextResponse.json({ ok: true, mission: dbMission })
    }
    // Fallback to in-memory if DB write fails
    const mission = createActiveMission({
      title: body.title,
      description: body.description,
      revenueTarget: Number(body.revenueTarget) || 0,
      priority: body.priority,
      category: body.category,
    })
    return NextResponse.json({ ok: true, mission })
  }

  if (action === 'advance') {
    if (!body.missionId) {
      return NextResponse.json({ ok: false, error: 'missionId required' }, { status: 400 })
    }
    // UPGRADE #143 — Load from DB, advance via in-memory logic, save back
    const dbMission = await getActiveMissionDB(body.missionId)
    if (dbMission) {
      // Use in-memory advance logic by injecting into the in-memory store
      // then re-persisting. This avoids duplicating the chain logic.
      // (active-missions.ts advanceMissionStage mutates an in-memory store —
      //  we replicate the artifact-gate check inline for DB missions.)
      const currentHandoff = dbMission.chain.find((c) => c.stage === dbMission.currentStage)
      if (currentHandoff && currentHandoff.artifactRequired !== 'none') {
        if (!currentHandoff.artifactValue || !currentHandoff.artifactVerified) {
          currentHandoff.status = 'blocked'
          currentHandoff.artifactVerifyError = currentHandoff.artifactVerifyError ||
            `Cannot advance: stage requires a ${currentHandoff.artifactRequired} artifact but none is verified.`
          dbMission.updatedAt = new Date().toISOString()
          await saveActiveMissionDB(dbMission)
          return NextResponse.json({ ok: true, mission: dbMission })
        }
      }
      // Artifact OK → advance
      const { STAGE_ORDER } = await import('@/lib/active-missions')
      const currentIdx = STAGE_ORDER.indexOf(dbMission.currentStage)
      if (currentIdx < STAGE_ORDER.length - 1) {
        if (currentHandoff) {
          currentHandoff.status = 'done'
          currentHandoff.completedAt = new Date().toISOString()
        }
        const nextStage = STAGE_ORDER[currentIdx + 1]
        dbMission.currentStage = nextStage
        const nextHandoff = dbMission.chain.find((c) => c.stage === nextStage)
        if (nextHandoff) {
          nextHandoff.status = 'active'
          nextHandoff.startedAt = new Date().toISOString()
        }
        dbMission.updatedAt = new Date().toISOString()
        dbMission.log.push({
          timestamp: new Date().toISOString(),
          actor: currentHandoff?.leader || 'SYSTEM',
          stage: dbMission.currentStage,
          message: `Stage advanced from ${STAGE_ORDER[currentIdx]} → ${nextStage}.`,
        })
        await saveActiveMissionDB(dbMission)
      }
      return NextResponse.json({ ok: true, mission: dbMission })
    }
    // Fallback to in-memory
    const mission = advanceMissionStage(body.missionId)
    if (!mission) {
      return NextResponse.json({ ok: false, error: 'Mission not found' }, { status: 404 })
    }
    return NextResponse.json({ ok: true, mission })
  }

  if (action === 'approve') {
    if (!body.missionId) {
      return NextResponse.json({ ok: false, error: 'missionId required' }, { status: 400 })
    }
    const dbMission = await getActiveMissionDB(body.missionId)
    if (dbMission) {
      const handoff = dbMission.chain.find((c) => c.stage === dbMission.currentStage)
      if (handoff) {
        handoff.status = 'done'
        handoff.completedAt = new Date().toISOString()
        handoff.notes = 'Owner approved. Mission complete.'
      }
      dbMission.currentStage = 'COMPLETED'
      dbMission.updatedAt = new Date().toISOString()
      dbMission.log.push({
        timestamp: new Date().toISOString(),
        actor: 'OWNER',
        stage: 'COMPLETED',
        message: 'Owner approved the mission. Marked COMPLETED.',
      })
      await saveActiveMissionDB(dbMission)
      return NextResponse.json({ ok: true, mission: dbMission })
    }
    const mission = approveMission(body.missionId)
    if (!mission) {
      return NextResponse.json({ ok: false, error: 'Mission not found' }, { status: 404 })
    }
    return NextResponse.json({ ok: true, mission })
  }

  // UPGRADE #120 — Set artifact for current stage
  if (action === 'set-artifact') {
    if (!body.missionId || !body.artifactValue) {
      return NextResponse.json({ ok: false, error: 'missionId and artifactValue required' }, { status: 400 })
    }
    const dbMission = await getActiveMissionDB(body.missionId)
    if (dbMission) {
      const handoff = dbMission.chain.find((c) => c.stage === dbMission.currentStage)
      if (handoff) {
        handoff.artifactValue = body.artifactValue
        handoff.artifactVerified = !!body.verified
        handoff.artifactVerifiedAt = body.verified ? new Date().toISOString() : null
        handoff.artifactVerifyError = null
        if (body.verified && handoff.status === 'blocked') handoff.status = 'active'
        dbMission.updatedAt = new Date().toISOString()
        await saveActiveMissionDB(dbMission)
        return NextResponse.json({ ok: true, mission: dbMission })
      }
    }
    const mission = setStageArtifact(body.missionId, body.artifactValue, !!body.verified)
    if (!mission) {
      return NextResponse.json({ ok: false, error: 'Mission not found' }, { status: 404 })
    }
    return NextResponse.json({ ok: true, mission })
  }

  // UPGRADE #120 — Verify artifact for current stage
  if (action === 'verify-artifact') {
    if (!body.missionId) {
      return NextResponse.json({ ok: false, error: 'missionId required' }, { status: 400 })
    }
    const dbMission = await getActiveMissionDB(body.missionId)
    if (dbMission) {
      // Run the in-memory verifyStageArtifact logic against the DB mission
      // by injecting it into the in-memory store, verifying, then reading back.
      // Simpler: do the verification inline.
      const handoff = dbMission.chain.find((c) => c.stage === dbMission.currentStage)
      if (handoff && handoff.artifactValue) {
        let verified = false
        if (handoff.artifactRequired === 'url') {
          try {
            const resp = await fetch(handoff.artifactValue, { method: 'HEAD', signal: AbortSignal.timeout(10000) }).catch(() => null)
            verified = !!(resp && resp.ok)
          } catch { verified = false }
        } else if (handoff.artifactRequired === 'transaction_id') {
          verified = handoff.artifactValue.length >= 8
        } else if (handoff.artifactRequired === 'message_id') {
          verified = handoff.artifactValue.length >= 4
        } else if (handoff.artifactRequired === 'data' || handoff.artifactRequired === 'file_path') {
          verified = handoff.artifactValue.length >= 10
        } else {
          verified = true
        }
        handoff.artifactVerified = verified
        handoff.artifactVerifiedAt = verified ? new Date().toISOString() : null
        if (verified && handoff.status === 'blocked') handoff.status = 'active'
        dbMission.updatedAt = new Date().toISOString()
        await saveActiveMissionDB(dbMission)
        return NextResponse.json({ ok: true, mission: dbMission })
      }
    }
    const mission = await verifyStageArtifact(body.missionId)
    if (!mission) {
      return NextResponse.json({ ok: false, error: 'Mission not found' }, { status: 404 })
    }
    return NextResponse.json({ ok: true, mission })
  }

  return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 })
}
