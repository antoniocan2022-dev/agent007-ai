/**
 * /api/system/improvement — UPGRADE #223
 *
 * Closed-Loop Improvement Cycle endpoint.
 *
 * GET /api/system/improvement → list all initiatives
 * POST /api/system/improvement → create new initiative
 *   Body: { recommendation, targetMetric, targetDirection }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getInitiatives, createInitiative } from '@/lib/closed-loop-improvement'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET() {
  const initiatives = await getInitiatives(50)
  return NextResponse.json({
    ok: true,
    count: initiatives.length,
    initiatives,
  })
}

export async function POST(req: NextRequest) {
  let body: any
  try { body = await req.json() }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }) }

  const { recommendation, targetMetric, targetDirection } = body ?? {}
  if (!recommendation || !targetMetric || !targetDirection) {
    return NextResponse.json({
      ok: false,
      error: 'Missing fields: recommendation, targetMetric, targetDirection required',
    }, { status: 400 })
  }

  const initiative = await createInitiative(recommendation, 'manual', targetMetric, targetDirection)
  return NextResponse.json({ ok: true, ...initiative })
}
