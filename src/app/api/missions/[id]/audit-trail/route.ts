/**
 * GET /api/missions/[id]/audit-trail — UPGRADE #140 (Rec 5)
 * Returns the full approval audit trail for a mission.
 *
 * Response:
 *   {
 *     ok: true,
 *     missionId: string,
 *     entries: ApprovalLogEntry[],
 *     summary: {
 *       totalEntries: number,
 *       stagesCompleted: number,
 *       rejections: number,
 *       escalations: number,
 *       lastActivity: string (ISO date)
 *     }
 *   }
 */
import { NextRequest, NextResponse } from 'next/server'
import { loadApprovalLog } from '@/lib/approval-audit-log'

export const dynamic = 'force-dynamic'
export const maxDuration = 10

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const missionId = params.id
    if (!missionId) {
      return NextResponse.json({ ok: false, error: 'Mission ID required' }, { status: 400 })
    }

    const entries = await loadApprovalLog(missionId)

    // Compute summary
    const stagesCompleted = new Set(
      entries
        .filter((e) => e.action === 'approved' || e.action === 'completed')
        .map((e) => e.stageId)
    ).size
    const rejections = entries.filter((e) => e.action === 'rejected').length
    const escalations = entries.filter((e) => e.action === 'escalated').length
    const lastEntry = entries[entries.length - 1]

    return NextResponse.json({
      ok: true,
      missionId,
      entries,
      summary: {
        totalEntries: entries.length,
        stagesCompleted,
        rejections,
        escalations,
        lastActivity: lastEntry?.timestamp ?? null,
      },
    })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'Unknown error' },
      { status: 500 }
    )
  }
}
