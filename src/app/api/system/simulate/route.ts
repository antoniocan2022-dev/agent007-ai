/**
 * /api/system/simulate — UPGRADE #224
 *
 * Executive Simulation endpoint.
 * Simulates 3 mission strategies before execution + predicts IQ.
 *
 * GET /api/system/simulate?goal=...&leaders=scout,quantum
 *   → returns 3 strategies with predicted quality metrics
 *
 * GET /api/system/simulate?goal=...&leaders=scout,quantum&predict=true
 *   → returns only the predicted IQ (no strategy simulation)
 */
import { NextRequest, NextResponse } from 'next/server'
import { simulateStrategies, predictMissionQuality, recommendStrategy } from '@/lib/predicted-iq'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const goal = url.searchParams.get('goal')
  const leadersParam = url.searchParams.get('leaders') || 'scout'
  const predictOnly = url.searchParams.get('predict') === 'true'

  if (!goal) {
    return NextResponse.json({
      ok: false,
      error: 'Missing "goal" query parameter',
      usage: 'GET /api/system/simulate?goal=analyze+Tesla+stock&leaders=scout,quantum',
    }, { status: 400 })
  }

  const leaders = leadersParam.split(',').map(l => l.trim().toLowerCase()).filter(Boolean)

  if (predictOnly) {
    const prediction = await predictMissionQuality(goal, leaders)
    return NextResponse.json({ ok: true, ...prediction })
  }

  const strategies = await simulateStrategies(goal, leaders)
  const recommended = recommendStrategy(strategies, 'quality')

  return NextResponse.json({
    ok: true,
    goal,
    proposedLeaders: leaders,
    strategies,
    recommended,
  })
}
