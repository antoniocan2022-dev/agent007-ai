/**
 * GET /api/missions/pipelines — UPGRADE #139 (Rec 4)
 * Lists all available mission pipeline types.
 *
 * Used by the dashboard to populate the "Pipeline Type" dropdown when
 * creating a new mission.
 */
import { NextResponse } from 'next/server'
import { listPipelineTypes } from '@/lib/mission-pipeline'

export const dynamic = 'force-dynamic'
export const maxDuration = 5

export async function GET() {
  try {
    const pipelines = listPipelineTypes()
    return NextResponse.json({ ok: true, pipelines })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'Unknown error' },
      { status: 500 }
    )
  }
}
