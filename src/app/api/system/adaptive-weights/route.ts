/**
 * /api/system/adaptive-weights — UPGRADE #225
 *
 * GET → current adaptive weights
 * POST → recalculate weights from historical data
 */
import { NextResponse, NextRequest } from 'next/server'
import { getAdaptiveWeights, recalculateWeights } from '@/lib/adaptive-weights'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET() {
  const weights = await getAdaptiveWeights()
  return NextResponse.json({ ok: true, ...weights })
}

export async function POST() {
  const weights = await recalculateWeights()
  return NextResponse.json({ ok: true, ...weights })
}
