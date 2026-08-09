import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { reconcileRevenueExecution } from '@/lib/revenue-reconciliation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function getAuthenticatedUserId() {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id
  if (!userId) return null
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } })
  return user?.id ?? null
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId()
    if (!userId) return NextResponse.json({ ok: false, error: 'Authentication required.' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const limit = Number(body?.limit ?? 100)
    const result = await reconcileRevenueExecution(userId, Number.isFinite(limit) ? limit : 100)
    return NextResponse.json({ ok: true, ...result })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? 'Revenue reconciliation failed.' }, { status: 500 })
  }
}
