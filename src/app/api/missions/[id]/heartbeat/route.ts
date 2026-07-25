/**
 * GET /api/missions/[id]/heartbeat — UPGRADE #144 (Rec 2 — Real-time monitoring)
 * Returns the LIVE status of a mission:
 *   - Current stage + elapsed time
 *   - Estimated time to completion
 *   - Status: working / stuck / errored / paused / completed
 *   - CEO watchdog verdict (healthy / warning / critical)
 *
 * Polled by the dashboard every 5 seconds while a mission is active.
 *
 * UPGRADE #146 (Critical #6 fix) — Auth required.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { loadHeartbeat, buildHeartbeatFromAuditLog, computeCeoWatchdog } from '@/lib/mission-heartbeat'

export const dynamic = 'force-dynamic'
export const maxDuration = 10

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // UPGRADE #146 — Auth required (was public, leaked live mission state)
    const session = await getServerSession()
    if (!session?.user) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { id: missionId } = await params
    if (!missionId) {
      return NextResponse.json({ ok: false, error: 'Mission ID required' }, { status: 400 })
    }

    // Try to load the saved heartbeat first
    let hb = await loadHeartbeat(missionId)

    if (!hb) {
      // No saved heartbeat — try to rebuild from audit log
      hb = await buildHeartbeatFromAuditLog({
        missionId,
        missionTitle: missionId,
        pipelineType: 'generic',
        totalStages: 6,
      })
    }

    // Recompute elapsed time + CEO watchdog on every poll (live freshness)
    if (hb.currentStage?.startedAt) {
      hb.currentStage.elapsedMs = Date.now() - new Date(hb.currentStage.startedAt).getTime()
    }
    hb.ceoWatchdog = computeCeoWatchdog(hb)
    hb.updatedAt = new Date().toISOString()

    return NextResponse.json({ ok: true, heartbeat: hb })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'Unknown error' },
      { status: 500 }
    )
  }
}

