import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { approveRevenueExecution, executeApprovedRevenueExecution, getRevenueExecutionQueue, prepareRevenueExecution, REVENUE_EXECUTION_ACTIONS, type RevenueExecutionAction } from '@/lib/revenue-execution'
import { getRevenueExecutorCatalog } from '@/lib/revenue-executors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function getAuthenticatedUserId() {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id
  if (!userId) return null
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } })
  return user?.id ?? null
}

export async function GET() {
  try {
    const userId = await getAuthenticatedUserId()
    if (!userId) return NextResponse.json({ ok: false, error: 'Authentication required.' }, { status: 401 })
    const actions = await getRevenueExecutionQueue(userId)
    return NextResponse.json({ ok: true, actions, executors: getRevenueExecutorCatalog() })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? 'Revenue execution queue failed.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId()
    if (!userId) return NextResponse.json({ ok: false, error: 'Authentication required.' }, { status: 401 })
    const body = await req.json().catch(() => ({}))
    const operation = String(body?.operation ?? 'prepare')

    if (operation === 'prepare') {
      const action = String(body?.action ?? '') as RevenueExecutionAction
      if (!REVENUE_EXECUTION_ACTIONS.includes(action)) return NextResponse.json({ ok: false, error: 'Unsupported revenue execution action.', allowedActions: REVENUE_EXECUTION_ACTIONS }, { status: 400 })
      const idempotencyKey = String(body?.idempotencyKey ?? '').trim()
      if (!idempotencyKey) return NextResponse.json({ ok: false, error: 'idempotencyKey is required.' }, { status: 400 })
      const prepared = await prepareRevenueExecution(userId, { action, idempotencyKey, customerId: body?.customerId ? String(body.customerId) : undefined, serviceId: body?.serviceId ? String(body.serviceId) : undefined, opportunityId: body?.opportunityId ? String(body.opportunityId) : undefined, payload: typeof body?.payload === 'object' && body.payload ? body.payload : {} })
      return NextResponse.json({ ok: true, operation, action: prepared })
    }

    if (operation === 'approve') {
      const actionId = String(body?.actionId ?? '').trim()
      if (!actionId) return NextResponse.json({ ok: false, error: 'actionId is required.' }, { status: 400 })
      const approved = await approveRevenueExecution(userId, actionId)
      return NextResponse.json({ ok: true, operation, action: approved, note: 'Approved for execution. No external message or payment was sent by this endpoint.' })
    }

    if (operation === 'execute') {
      const actionId = String(body?.actionId ?? '').trim()
      if (!actionId) return NextResponse.json({ ok: false, error: 'actionId is required.' }, { status: 400 })
      const executed = await executeApprovedRevenueExecution(userId, actionId)
      return NextResponse.json({ ok: true, operation, action: executed, note: 'Execution completed by a registered capability-specific executor. Revenue remains unverified until processor-backed transaction evidence exists.' })
    }

    return NextResponse.json({ ok: false, error: 'Unknown operation. Use prepare, approve, or execute.' }, { status: 400 })
  } catch (error: any) {
    const status = error?.message?.startsWith('No authorized executor') ? 409 : 500
    return NextResponse.json({ ok: false, error: error?.message ?? 'Revenue execution action failed.', action: error?.action ?? undefined }, { status })
  }
}
