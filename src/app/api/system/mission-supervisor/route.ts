import { NextRequest, NextResponse } from 'next/server'
import { getMissionSupervisorSnapshot, runMissionSupervisorCycle } from '@/lib/mission-supervisor'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await req.json().catch(() => ({})) as { missionId?: string; maxMissions?: number; maxLeaderRuns?: number; staleMinutes?: number }
    if (body.missionId) {
      const snapshot = await getMissionSupervisorSnapshot(body.missionId)
      if (!snapshot) return NextResponse.json({ ok: false, error: 'Mission not found' }, { status: 404 })
      return NextResponse.json({ ok: true, mode: 'inspect', ...snapshot })
    }
    const result = await runMissionSupervisorCycle({
      maxMissions: Math.min(Math.max(body.maxMissions ?? 5, 1), 10),
      maxLeaderRuns: Math.min(Math.max(body.maxLeaderRuns ?? 2, 0), 3),
      staleMinutes: Math.min(Math.max(body.staleMinutes ?? 30, 5), 24 * 60),
    })
    return NextResponse.json({ ok: true, mode: 'cycle', ...result })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return POST(req)
}
