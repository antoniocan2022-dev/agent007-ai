/**
 * /api/system/evolution — UPGRADE #222 + #226
 *
 * The Evolution Engine endpoint.
 * Returns the Organizational Health Report + Organizational IQ.
 *
 * GET /api/system/evolution → generate + return health report
 * GET /api/system/evolution?history=true → past 7 reports
 * GET /api/system/evolution?iq=true → just the Org IQ score
 * GET /api/system/evolution?cycle=true → run active evolution cycle (Observe→Recommend→Approve→Apply→Verify)
 */
import { NextRequest, NextResponse } from 'next/server'
import { generateHealthReport, computeOrganizationalIQ, getEvolutionHistory, runActiveEvolutionCycle } from '@/lib/evolution-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const historyOnly = url.searchParams.get('history') === 'true'
  const iqOnly = url.searchParams.get('iq') === 'true'
  const cycleMode = url.searchParams.get('cycle') === 'true'

  if (cycleMode) {
    const cycle = await runActiveEvolutionCycle()
    return NextResponse.json({ ok: true, ...cycle })
  }

  if (historyOnly) {
    const history = await getEvolutionHistory(7)
    return NextResponse.json({ ok: true, count: history.length, history })
  }

  if (iqOnly) {
    const iq = await computeOrganizationalIQ()
    return NextResponse.json({ ok: true, ...iq })
  }

  const report = await generateHealthReport()
  return NextResponse.json({ ok: true, ...report })
}
