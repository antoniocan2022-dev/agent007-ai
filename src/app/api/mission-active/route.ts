/**
 * /api/mission-active — UPGRADE #111 + #120
 * List active missions with team-chain state.
 *
 * GET  /api/mission-active                       — list all active missions
 * POST /api/mission-active                       — create new mission { title, description, revenueTarget, priority, category }
 * POST /api/mission-active?action=advance        — advance a mission to next stage { missionId } (BLOCKED if artifact not verified)
 * POST /api/mission-active?action=approve        — owner approves mission { missionId }
 * POST /api/mission-active?action=set-artifact   — set artifact for current stage { missionId, artifactValue }
 * POST /api/mission-active?action=verify-artifact — verify artifact for current stage { missionId }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import {
  listActiveMissions,
  createActiveMission,
  advanceMissionStage,
  setStageArtifact,
  verifyStageArtifact,
  approveMission,
} from '@/lib/active-missions'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const missions = listActiveMissions()
  return NextResponse.json({
    ok: true,
    count: missions.length,
    missions,
  })
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
    const mission = await verifyStageArtifact(body.missionId)
    if (!mission) {
      return NextResponse.json({ ok: false, error: 'Mission not found' }, { status: 404 })
    }
    return NextResponse.json({ ok: true, mission })
  }

  return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 })
}
