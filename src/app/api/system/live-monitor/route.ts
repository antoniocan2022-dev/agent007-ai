/**
 * /api/system/live-monitor — UPGRADE #225
 *
 * Returns active mission monitors + alerts.
 *
 * GET /api/system/live-monitor → all active monitors
 * GET /api/system/live-monitor?mission=mission_xxx → alerts for specific mission
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAllActiveMonitors, getActiveAlerts } from '@/lib/live-monitor'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const missionId = url.searchParams.get('mission')

  if (missionId) {
    const alerts = getActiveAlerts(missionId)
    return NextResponse.json({ ok: true, missionId, alertCount: alerts.length, alerts })
  }

  const monitors = getAllActiveMonitors()
  return NextResponse.json({
    ok: true,
    activeMissions: monitors.length,
    monitors,
  })
}
