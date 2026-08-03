/**
 * /api/system/dual-missions — UPGRADE #228
 *
 * Dual Leader Missions endpoint.
 *
 * GET /api/system/dual-missions → all leader missions
 * GET /api/system/dual-missions?leader=quantum → specific leader
 */
import { NextRequest, NextResponse } from 'next/server'
import { getDualMissions, getDualMission } from '@/lib/business-portfolio'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const leaderId = url.searchParams.get('leader')

  if (leaderId) {
    const mission = getDualMission(leaderId)
    if (!mission) {
      return NextResponse.json({ ok: false, error: `No dual mission found for leader: ${leaderId}` }, { status: 404 })
    }
    return NextResponse.json({ ok: true, ...mission })
  }

  const missions = getDualMissions()
  return NextResponse.json({ ok: true, count: missions.length, missions })
}
