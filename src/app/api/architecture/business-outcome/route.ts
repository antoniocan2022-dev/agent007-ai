import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { assertVentureActionAllowed, recordBusinessOutcome } from '@/lib/architecture-control-plane'

export const dynamic = 'force-dynamic'

/**
 * Canonical business-outcome ingestion endpoint.
 *
 * The endpoint deliberately does not create or mutate payment transactions.
 * It records an already-observed business outcome and requires the Venture
 * Control Contract to authorize that action. This keeps the ledger factual
 * and prevents it from becoming a synthetic revenue generator.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const ventureId = typeof body.ventureId === 'string' ? body.ventureId.trim() : ''
  const type = typeof body.type === 'string' ? body.type.trim() : ''
  const source = typeof body.source === 'string' ? body.source.trim() : ''
  const occurredAt = typeof body.occurredAt === 'string' ? body.occurredAt : new Date().toISOString()

  if (!ventureId || !type || !source) {
    return NextResponse.json({ ok: false, error: 'ventureId, type and source are required' }, { status: 400 })
  }

  try {
    await assertVentureActionAllowed(ventureId, 'record_outcome')
    const outcome = await recordBusinessOutcome({
      ventureId,
      missionId: typeof body.missionId === 'string' ? body.missionId : null,
      type,
      transactionId: typeof body.transactionId === 'string' ? body.transactionId : null,
      customerId: typeof body.customerId === 'string' ? body.customerId : null,
      amount: typeof body.amount === 'number' ? body.amount : null,
      currency: typeof body.currency === 'string' ? body.currency : null,
      source,
      occurredAt,
      metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
    } as any)
    return NextResponse.json({ ok: true, outcome })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? 'Business outcome rejected' }, { status: 400 })
  }
}
