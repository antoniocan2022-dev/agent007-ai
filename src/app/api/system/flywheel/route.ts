/**
 * /api/system/flywheel — UPGRADE #228
 *
 * Business Flywheel endpoint.
 *
 * GET /api/system/flywheel → run full flywheel cycle
 * GET /api/system/flywheel?stage=observe → run single stage
 */
import { NextRequest, NextResponse } from 'next/server'
import { runFlywheel, type FlywheelStage } from '@/lib/business-portfolio'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const stage = url.searchParams.get('stage') as FlywheelStage | null
  const mode = stage ? 'single' : 'full'

  const result = await runFlywheel(mode, stage || undefined)
  return NextResponse.json({ ok: true, ...result })
}
