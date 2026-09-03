/**
 * /api/system/evolution — governed evolution and organizational health.
 *
 * GET ?cycle=true only observes, proposes and simulates. It never approves or
 * applies a change. POST is the explicit approval/application surface.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { generateHealthReport, computeOrganizationalIQ, getEvolutionHistory } from '@/lib/evolution-engine'
import { runGovernedEvolutionCycle } from '@/lib/ceo-continuous-loop'
import { approveInitiative, applyInitiative, measureInitiative, resolveInitiative, getInitiative } from '@/lib/closed-loop-improvement'
import type { MissionTelemetry } from '@/lib/mission-telemetry'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function requireSession() {
  const session = await getServerSession(authOptions)
  return session?.user ? session : null
}

export async function GET(req: NextRequest) {
  if (!await requireSession()) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const historyOnly = url.searchParams.get('history') === 'true'
  const iqOnly = url.searchParams.get('iq') === 'true'
  const cycleMode = url.searchParams.get('cycle') === 'true'
  if (cycleMode) return NextResponse.json({ ok: true, ...(await runGovernedEvolutionCycle()) })
  if (historyOnly) { const history = await getEvolutionHistory(7); return NextResponse.json({ ok: true, count: history.length, history }) }
  if (iqOnly) { const iq = await computeOrganizationalIQ(); return NextResponse.json({ ok: true, ...iq }) }
  return NextResponse.json({ ok: true, ...(await generateHealthReport()) })
}

export async function POST(req: NextRequest) {
  const session = await requireSession()
  if (!session) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const action = typeof body.action === 'string' ? body.action.trim().toLowerCase() : ''
  const initiativeId = typeof body.initiativeId === 'string' ? body.initiativeId.trim() : ''
  if (!initiativeId) return NextResponse.json({ ok: false, error: 'initiativeId is required' }, { status: 400 })
  try {
    if (action === 'approve') return NextResponse.json({ ok: true, initiative: await approveInitiative(initiativeId, typeof session.user?.email === 'string' ? session.user.email : 'owner', typeof body.reason === 'string' ? body.reason : 'Explicit owner approval') })
    if (action === 'apply') return NextResponse.json({ ok: true, initiative: await applyInitiative(initiativeId) })
    if (action === 'measure') {
      if (!body.telemetry || typeof body.telemetry !== 'object' || Array.isArray(body.telemetry)) return NextResponse.json({ ok: false, error: 'telemetry is required for measurement' }, { status: 400 })
      return NextResponse.json({ ok: true, initiative: await measureInitiative(initiativeId, body.telemetry as MissionTelemetry) })
    }
    if (action === 'resolve') {
      const decision = body.decision === 'KEEP' || body.decision === 'ROLLBACK' ? body.decision : null
      if (!decision) return NextResponse.json({ ok: false, error: 'decision must be KEEP or ROLLBACK' }, { status: 400 })
      return NextResponse.json({ ok: true, initiative: await resolveInitiative(initiativeId, decision, typeof body.reason === 'string' ? body.reason : 'Owner resolution') })
    }
    const initiative = await getInitiative(initiativeId)
    return NextResponse.json({ ok: Boolean(initiative), initiative }, { status: initiative ? 200 : 404 })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
