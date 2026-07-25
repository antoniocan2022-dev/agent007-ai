/**
 * POST /api/missions/run — UPGRADE #139 (Rec 4)
 * Triggers a mission pipeline run.
 *
 * Body: {
 *   missionId: string,
 *   pipelineType: 'product_launch' | 'content_creation' | 'affiliate_campaign' | 'generic',
 *   objective: string,
 *   missionTitle?: string,
 *   skipOwnerApproval?: boolean  // testing only
 * }
 *
 * This endpoint runs the pipeline ASYNCHRONOUSLY — it returns immediately
 * with a "started" response, and the pipeline continues in the background.
 * Progress is logged to the audit trail + sent via Telegram.
 *
 * The dashboard polls /api/missions/[id]/audit-trail for live updates.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { runMissionPipeline, MISSION_PIPELINES } from '@/lib/mission-pipeline'

export const dynamic = 'force-dynamic'
export const maxDuration = 300  // 5 min — pipeline can take a while

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession()
    if (!session?.user) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const { missionId, pipelineType, objective, missionTitle, skipOwnerApproval } = body

    if (!missionId) {
      return NextResponse.json({ ok: false, error: 'missionId required' }, { status: 400 })
    }
    if (!objective) {
      return NextResponse.json({ ok: false, error: 'objective required' }, { status: 400 })
    }

    // Validate pipeline type (fall back to generic)
    const type = MISSION_PIPELINES[pipelineType] ? pipelineType : 'generic'

    // Run SYNCHRONOUSLY in this request — Vercel allows up to 300s on Pro plan.
    // For longer missions, the pipeline checkpoints progress to the audit trail
    // at every stage, so even if this request times out, the next request can
    // poll /api/missions/[id]/audit-trail to see how far it got.
    const result = await runMissionPipeline({
      missionId,
      pipelineType: type,
      objective,
      missionTitle,
      skipOwnerApproval,
    })

    return NextResponse.json({ ok: true, result })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'Unknown error' },
      { status: 500 }
    )
  }
}
