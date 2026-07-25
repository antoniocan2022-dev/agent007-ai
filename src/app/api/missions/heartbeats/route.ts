/**
 * GET /api/missions/heartbeats — UPGRADE #144 (Rec 2 — Real-time monitoring)
 * Lists the LIVE status of ALL active missions.
 *
 * Used by the dashboard's "Active Missions Monitor" widget.
 *
 * UPGRADE #146 (Critical #6 fix) — Auth required.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { listHeartbeats, computeCeoWatchdog } from '@/lib/mission-heartbeat'

export const dynamic = 'force-dynamic'
export const maxDuration = 10

export async function GET() {
  try {
    // UPGRADE #146 — Auth required (was public, leaked live mission state)
    const session = await getServerSession()
    if (!session?.user) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const heartbeats = await listHeartbeats()

    // Recompute elapsed + watchdog on every poll (live freshness)
    const now = Date.now()
    const fresh = heartbeats.map((hb) => {
      if (hb.currentStage?.startedAt) {
        hb.currentStage.elapsedMs = now - new Date(hb.currentStage.startedAt).getTime()
      }
      hb.ceoWatchdog = computeCeoWatchdog(hb)
      return hb
    })

    return NextResponse.json({
      ok: true,
      count: fresh.length,
      heartbeats: fresh,
    })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'Unknown error' },
      { status: 500 }
    )
  }
}
