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

async function reconcile(req: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET?.trim()
    const authorization = req.headers.get('authorization')
    const cronAuthorized = Boolean(cronSecret && authorization === `Bearer ${cronSecret}`)
    if (cronAuthorized) {
      const users = await db.user.findMany({ select: { id: true } })
      let checked = 0, verified = 0
      for (const user of users) {
        const result = await reconcileRevenueExecution(user.id, 100)
        checked += result.checked
        verified += result.verified
      }
      return NextResponse.json({ ok: true, mode: 'cron', users: users.length, checked, verified })
    }
    const userId = await getAuthenticatedUserId()
    if (!userId) return NextResponse.json({ ok: false, error: 'Authentication required.' }, { status: 401 })
    const body = await req.json().catch(() => ({}))
    const limit = Number(body?.limit ?? 100)
    const result = await reconcileRevenueExecution(userId, Number.isFinite(limit) ? limit : 100)
    return NextResponse.json({ ok: true, mode: 'operator', ...result })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? 'Revenue reconciliation failed.' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) { return reconcile(req) }
export async function POST(req: NextRequest) { return reconcile(req) }
