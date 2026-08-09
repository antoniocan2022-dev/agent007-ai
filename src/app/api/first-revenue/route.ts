import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { addProspect, getFirstRevenueMission, initializeFirstRevenueMission } from '@/lib/first-revenue-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function getOperator() {
  return db.user.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } })
}

export async function GET() {
  try {
    const user = await getOperator()
    if (!user) return NextResponse.json({ ok: false, error: 'No operator user configured.' }, { status: 503 })

    const mission = await getFirstRevenueMission(user.id)
    return NextResponse.json({ ok: true, mission })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? 'First revenue mission failed.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getOperator()
    if (!user) return NextResponse.json({ ok: false, error: 'No operator user configured.' }, { status: 503 })

    const body = await req.json().catch(() => ({}))
    const action = String(body?.action ?? 'status')

    if (action === 'initialize') {
      const result = await initializeFirstRevenueMission(user.id)
      return NextResponse.json({ ok: true, action, ...result })
    }

    if (action === 'add_prospect') {
      const customer = await addProspect(user.id, {
        name: String(body?.name ?? ''),
        email: body?.email,
        company: body?.company,
        source: body?.source,
        notes: body?.notes,
      })
      const mission = await getFirstRevenueMission(user.id)
      return NextResponse.json({ ok: true, action, customer, mission })
    }

    if (action === 'status') {
      const mission = await getFirstRevenueMission(user.id)
      return NextResponse.json({ ok: true, action, mission })
    }

    return NextResponse.json({
      ok: false,
      error: `Unknown action: ${action}. Use initialize, add_prospect, or status.`,
    }, { status: 400 })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? 'First revenue action failed.' }, { status: 500 })
  }
}
