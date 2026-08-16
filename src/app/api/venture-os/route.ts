import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { acquireAutonomyLease, evaluateVentureReadiness, heartbeatAutonomyLease, instantiateVentureTemplate, pauseAutonomy, runV001EvidenceTest } from '@/lib/venture-autonomy-control'
import { calculateOperationalKpis, persistOperationalKpiSnapshot } from '@/lib/operational-kpi-engine'
import { runVentureOperationCycle } from '@/lib/venture-operation-loop'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authenticatedOwner(session: { user?: { email?: string | null; name?: string | null } }): string {
  return session.user?.email ?? session.user?.name ?? 'authenticated-user'
}

export async function GET(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const ventureId = new URL(req.url).searchParams.get('ventureId')?.trim() || 'venture_001'
  try {
    const readiness = await evaluateVentureReadiness(ventureId)
    const kpi = await calculateOperationalKpis(ventureId, 24)
    return NextResponse.json({ ok: true, readiness, kpi })
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Venture OS state failed' }, { status: 400 })
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const ventureId = typeof body.ventureId === 'string' && body.ventureId.trim() ? body.ventureId.trim() : 'venture_001'
  const owner = authenticatedOwner(session)

  try {
    switch (body.action) {
      case 'readiness':
        return NextResponse.json({ ok: true, readiness: await evaluateVentureReadiness(ventureId) })
      case 'kpi': {
        const snapshot = await calculateOperationalKpis(ventureId, Number(body.windowHours ?? 24))
        await persistOperationalKpiSnapshot(snapshot)
        return NextResponse.json({ ok: true, snapshot })
      }
      case 'operate':
        return NextResponse.json(await runVentureOperationCycle(ventureId, owner))
      case 'evidence-test':
        return NextResponse.json(await runV001EvidenceTest())
      case 'acquire-lease':
        return NextResponse.json({ ok: true, lease: await acquireAutonomyLease(ventureId, body.mode ?? 'SUPERVISED', owner, Number(body.ttlSeconds ?? 300)) })
      case 'heartbeat':
        return NextResponse.json({ ok: true, lease: await heartbeatAutonomyLease(ventureId, body.leaseId) })
      case 'pause':
        await pauseAutonomy(ventureId, owner)
        return NextResponse.json({ ok: true, paused: true })
      case 'instantiate-template':
        return NextResponse.json({ ok: true, template: await instantiateVentureTemplate(ventureId, body.name) })
      default:
        return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 })
    }
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Venture OS action failed' }, { status: 400 })
  }
}
