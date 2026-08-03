/**
 * /api/system/evolution — UPGRADE #222
 *
 * The Evolution Engine endpoint.
 * Returns the Organizational Health Report + Organizational IQ.
 *
 * GET /api/system/evolution → generate + return health report
 * GET /api/system/evolution?history=true → past 7 reports
 * GET /api/system/evolution?iq=true → just the Org IQ score
 */
import { NextRequest, NextResponse } from 'next/server'
import { generateHealthReport, computeOrganizationalIQ, getEvolutionHistory } from '@/lib/evolution-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const historyOnly = url.searchParams.get('history') === 'true'
  const iqOnly = url.searchParams.get('iq') === 'true'

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
