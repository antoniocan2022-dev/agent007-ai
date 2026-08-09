import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { addProspect, getFirstRevenueMission, initializeFirstRevenueMission } from '@/lib/first-revenue-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function getAuthenticatedUser() {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id
  if (!userId) return null

  return db.user.findUnique({
    where: { id: userId },
    select: { id: true },
  })
}

export async function GET() {
  try {
    const user = await getAuthenticatedUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Authentication required.' }, { status: 401 })

    const mission = await getFirstRevenueMission(user.id)
    return NextResponse.json({ ok: true, mission })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? 'First revenue mission failed.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Authentication required.' }, { status: 401 })

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
