/**
 * /api/system/evolution — governed evolution and organizational health.
 *
 * The cycle endpoint is intentionally routed through ceo-continuous-loop so
 * there is one governed evolution path: OBSERVE → DIAGNOSE → PROPOSE →
 * SIMULATE → APPROVE → APPLY → VERIFY → KEEP/ROLLBACK.
 */
import { NextRequest, NextResponse } from 'next/server'
import { generateHealthReport, computeOrganizationalIQ, getEvolutionHistory } from '@/lib/evolution-engine'
import { runGovernedEvolutionCycle } from '@/lib/ceo-continuous-loop'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const historyOnly = url.searchParams.get('history') === 'true'
  const iqOnly = url.searchParams.get('iq') === 'true'
  const cycleMode = url.searchParams.get('cycle') === 'true'
  if (cycleMode) { const cycle = await runGovernedEvolutionCycle(); return NextResponse.json({ ok: true, ...cycle }) }
  if (historyOnly) { const history = await getEvolutionHistory(7); return NextResponse.json({ ok: true, count: history.length, history }) }
  if (iqOnly) { const iq = await computeOrganizationalIQ(); return NextResponse.json({ ok: true, ...iq }) }
  const report = await generateHealthReport()
  return NextResponse.json({ ok: true, ...report })
}
