import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { advanceCommercialOrder, createCommercialOrder, type CommercialState } from '@/lib/venture-autonomy-control'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  try {
    if (body.action === 'create') {
      const order = await createCommercialOrder({
        ventureId: body.ventureId,
        tenantId: body.tenantId,
        customerId: String(body.customerId ?? ''),
        orderId: String(body.orderId ?? ''),
        amount: Number(body.amount),
        currency: String(body.currency ?? ''),
      })
      return NextResponse.json({ ok: true, order })
    }
    if (body.action === 'advance') {
      const state = String(body.state ?? '') as CommercialState
      const order = await advanceCommercialOrder(String(body.commercialId ?? ''), state, body.paymentId ?? null, body.provider ?? null)
      return NextResponse.json({ ok: true, order })
    }
    return NextResponse.json({ ok: false, error: 'action must be create or advance' }, { status: 400 })
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Commercial lifecycle failed' }, { status: 400 })
  }
}
