/**
 * /api/mission-active — UPGRADE #111
 * List active missions with team-chain state.
 *
 * GET  /api/mission-active                — list all active missions
 * POST /api/mission-active                — create new mission { title, description, revenueTarget, priority, category }
 * POST /api/mission-active?action=advance — advance a mission to next stage { missionId }
 * POST /api/mission-active?action=approve — owner approves mission { missionId }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import {
  listActiveMissions,
  createActiveMission,
  advanceMissionStage,
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

  return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 })
}
