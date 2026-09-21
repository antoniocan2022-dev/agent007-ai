import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { ensureVenture001, getVenture001State } from '@/lib/venture-001'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function requireSessionUserId(): Promise<string | NextResponse> {
  const session = await getServerSession(authOptions)
  const userId = typeof (session?.user as { id?: unknown } | undefined)?.id === 'string' ? (session!.user as { id: string }).id : ''
  return userId || NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
}

export async function GET() {
  const sessionResult = await requireSessionUserId()
  if (sessionResult instanceof NextResponse) return sessionResult
  return NextResponse.json({ ok: true, ...(await getVenture001State()) })
}

// Production incident (2026-09-21): this handler called ensureVenture001() with no ownerUserId,
// even though an authenticated session was already required to reach it. ensureVenture001 only
// creates the RELATIONAL Venture/BusinessUnit identity (createOrGetVenture) when ownerUserId is
// truthy -- every branch gates it behind `if (ownerUserId)`. Without it, this endpoint could only
// ever create/repair the legacy Memory-JSON portfolio Business record, never the relational row
// commercial-organization-scope.ts's businessKeyForVenture() queries via SQL join. The live
// symptom: runVentureOperationCycle (the 24x7 heartbeat's own operation cycle) failed every run
// with "Venture venture_001 has no canonical BusinessUnit scope," because no amount of hitting
// this bootstrap endpoint could ever have created that scope. Passing the authenticated owner's
// id through closes the gap this endpoint exists to close.
export async function POST() {
  const sessionResult = await requireSessionUserId()
  if (sessionResult instanceof NextResponse) return sessionResult
  try {
    const result = await ensureVenture001(sessionResult)
    return NextResponse.json({ ok: true, ...result }, { status: result.created ? 201 : 200 })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Venture 001 initialization failed.' }, { status: 500 })
  }
}
