import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { acquireAutonomyLease, evaluateVentureReadiness, heartbeatAutonomyLease, instantiateVentureTemplate, pauseAutonomy, runV001EvidenceTest } from '@/lib/venture-autonomy-control'

export const dynamic = 'force-dynamic'

function authenticatedOwner(session: { user?: { email?: string | null; name?: string | null } }): string {
  return session.user?.email ?? session.user?.name ?? 'authenticated-user'
}

export async function GET(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const ventureId = new URL(req.url).searchParams.get('ventureId') ?? 'venture_001'
  try {
    return NextResponse.json({ ok: true, readiness: await evaluateVentureReadiness(ventureId) })
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Venture readiness failed' }, { status: 400 })
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
      case 'readiness': return NextResponse.json({ ok: true, readiness: await evaluateVentureReadiness(ventureId) })
      case 'evidence-test': return NextResponse.json(await runV001EvidenceTest())
      case 'acquire-lease': return NextResponse.json({ ok: true, lease: await acquireAutonomyLease(ventureId, body.mode ?? 'SUPERVISED', owner) })
      case 'heartbeat': return NextResponse.json({ ok: true, lease: await heartbeatAutonomyLease(ventureId, body.leaseId) })
      case 'pause': await pauseAutonomy(ventureId); return NextResponse.json({ ok: true, paused: true })
      case 'instantiate-template': return NextResponse.json({ ok: true, template: await instantiateVentureTemplate(ventureId, body.name) })
      default: return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 })
    }
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Venture OS action failed' }, { status: 400 })
  }
}
