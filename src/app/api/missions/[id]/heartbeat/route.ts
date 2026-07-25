/**
 * GET /api/missions/[id]/heartbeat — UPGRADE #144 (Rec 2 — Real-time monitoring)
 * Returns the LIVE status of a mission:
 *   - Current stage + elapsed time
 *   - Estimated time to completion
 *   - Status: working / stuck / errored / paused / completed
 *   - CEO watchdog verdict (healthy / warning / critical)
 *
 * Polled by the dashboard every 5 seconds while a mission is active.
 */
import { NextRequest, NextResponse } from 'next/server'
import { loadHeartbeat, buildHeartbeatFromAuditLog, computeCeoWatchdog } from '@/lib/mission-heartbeat'

export const dynamic = 'force-dynamic'
export const maxDuration = 10

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const missionId = params.id
    if (!missionId) {
      return NextResponse.json({ ok: false, error: 'Mission ID required' }, { status: 400 })
    }

    // Try to load the saved heartbeat first
    let hb = await loadHeartbeat(missionId)

    if (!hb) {
      // No saved heartbeat — try to rebuild from audit log
      // (this happens on first poll after a mission starts, before any
      //  heartbeat has been written yet)
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

