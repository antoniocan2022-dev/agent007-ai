/**
 * POST /api/missions/run — UPGRADE #139 (Rec 4)
 * Triggers a mission pipeline run.
 *
 * Body: {
 *   missionId: string,
 *   pipelineType: 'product_launch' | 'content_creation' | 'affiliate_campaign' | 'generic',
 *   objective: string,
 *   missionTitle?: string,
 *   skipOwnerApproval?: boolean  // UPGRADE #146 — OWNER-ONLY, ignored for non-operators
 * }
 *
 * This endpoint runs the pipeline SYNCHRONOUSLY within the request.
 * Progress is logged to the audit trail + sent via Telegram.
 *
 * The dashboard polls /api/missions/[id]/heartbeat for live updates.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { runMissionPipeline, MISSION_PIPELINES } from '@/lib/mission-pipeline'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const maxDuration = 300  // 5 min — pipeline can take a while

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession()
    if (!session?.user) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const { missionId, pipelineType, objective, missionTitle } = body

    if (!missionId) {
      return NextResponse.json({ ok: false, error: 'missionId required' }, { status: 400 })
    }
    if (!objective) {
      return NextResponse.json({ ok: false, error: 'objective required' }, { status: 400 })
    }

    // UPGRADE #146 (Critical #5 fix) — Only the OPERATOR (first user) can bypass
    // the owner approval gate. Any other authenticated user passing
    // `{skipOwnerApproval: true}` will have it silently ignored.
    let effectiveSkipApproval = false
    try {
      const operator = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
      if (operator && (session.user as any).email === operator.email) {
        effectiveSkipApproval = !!body.skipOwnerApproval
      }
    } catch {
      // DB error — fail-closed (no bypass allowed)
    }

    // Validate pipeline type (fall back to generic)
    const type = MISSION_PIPELINES[pipelineType] ? pipelineType : 'generic'

    // Run SYNCHRONOUSLY in this request — Vercel allows up to 300s on Pro plan.
    // For longer missions, the pipeline checkpoints progress to the audit trail
    // at every stage, so even if this request times out, the next request can
    // poll /api/missions/[id]/heartbeat to see how far it got.
    const result = await runMissionPipeline({
      missionId,
      pipelineType: type,
      objective,
      missionTitle,
      skipOwnerApproval: effectiveSkipApproval,
    })

    return NextResponse.json({ ok: true, result })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'Unknown error' },
      { status: 500 }
    )
  }
}
