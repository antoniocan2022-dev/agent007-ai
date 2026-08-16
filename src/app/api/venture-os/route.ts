import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { acquireAutonomyLease, evaluateVentureReadiness, heartbeatAutonomyLease, instantiateVentureTemplate, pauseAutonomy, runV001EvidenceTest } from '@/lib/venture-autonomy-control'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ventureId = new URL(req.url).searchParams.get('ventureId') ?? 'venture_001'
  return NextResponse.json({ ok: true, readiness: await evaluateVentureReadiness(ventureId) })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  try {
    switch (body.action) {
      case 'readiness': return NextResponse.json({ ok: true, readiness: await evaluateVentureReadiness(body.ventureId ?? 'venture_001') })
      case 'evidence-test': return NextResponse.json(await runV001EvidenceTest())
      case 'acquire-lease': return NextResponse.json({ ok: true, lease: await acquireAutonomyLease(body.ventureId ?? 'venture_001', body.mode ?? 'SUPERVISED', body.owner ?? 'agent007') })
      case 'heartbeat': return NextResponse.json({ ok: true, lease: await heartbeatAutonomyLease(body.ventureId ?? 'venture_001', body.leaseId) })
      case 'pause': await pauseAutonomy(body.ventureId ?? 'venture_001'); return NextResponse.json({ ok: true, paused: true })
      case 'instantiate-template': return NextResponse.json({ ok: true, template: await instantiateVentureTemplate(body.ventureId, body.name) })
      default: return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 })
    }
  } catch (error: any) { return NextResponse.json({ ok: false, error: error?.message ?? 'Venture OS action failed' }, { status: 400 }) }
}
