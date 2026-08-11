import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session-user'
import {
  approveRevenueApproval,
  cancelRevenueApproval,
  claimRevenueApproval,
  completeRevenueApproval,
  listRevenueApprovals,
  prepareRevenueApproval,
} from '@/lib/revenue-approval'
import { isAllowedRevenueAction, REVENUE_ACTIONS, type RevenueAction } from '@/lib/revenue-execution-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function authenticatedUserId() {
  const user = await getSessionUser()
  return user?.id ?? null
}

export async function GET() {
  const userId = await authenticatedUserId()
  if (!userId) return NextResponse.json({ ok: false, error: 'Authentication required.' }, { status: 401 })

  try {
    return NextResponse.json({ ok: true, actions: await listRevenueApprovals(userId) })
  } catch {
    return NextResponse.json({ ok: false, error: 'Unable to load the revenue approval queue.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const userId = await authenticatedUserId()
  if (!userId) return NextResponse.json({ ok: false, error: 'Authentication required.' }, { status: 401 })

  try {
    const body = await req.json().catch(() => ({}))
    const operation = String(body?.operation ?? 'prepare')

    if (operation === 'prepare') {
      const action = String(body?.action ?? '')
      if (!isAllowedRevenueAction(action)) {
        return NextResponse.json({ ok: false, error: 'Unsupported revenue action.', allowedActions: REVENUE_ACTIONS }, { status: 400 })
      }
      const prepared = await prepareRevenueApproval(userId, {
        action: action as RevenueAction,
        idempotencyKey: String(body?.idempotencyKey ?? ''),
        customerId: body?.customerId ? String(body.customerId) : undefined,
        serviceId: body?.serviceId ? String(body.serviceId) : undefined,
        opportunityId: body?.opportunityId ? String(body.opportunityId) : undefined,
        payload: typeof body?.payload === 'object' && body.payload !== null ? body.payload : {},
      })
      return NextResponse.json({ ok: true, operation, action: prepared })
    }

    const actionId = String(body?.actionId ?? '').trim()
    if (!actionId) return NextResponse.json({ ok: false, error: 'actionId is required.' }, { status: 400 })

    if (operation === 'approve') {
      const action = await approveRevenueApproval(userId, actionId)
      return NextResponse.json({ ok: true, operation, action, externalSideEffect: false })
    }

    if (operation === 'claim') {
      const action = await claimRevenueApproval(userId, actionId)
      return NextResponse.json({ ok: true, operation, action, providerCallsPerformed: false })
    }

    if (operation === 'complete') {
      const action = await completeRevenueApproval(userId, actionId, {
        externalSideEffect: Boolean(body?.externalSideEffect),
        provider: body?.provider ? String(body.provider) : undefined,
        providerReference: body?.providerReference ? String(body.providerReference) : undefined,
        revenueVerified: Boolean(body?.revenueVerified),
        result: typeof body?.result === 'object' && body.result !== null ? body.result : {},
      })
      return NextResponse.json({ ok: true, operation, action })
    }

    if (operation === 'cancel') {
      const action = await cancelRevenueApproval(userId, actionId, String(body?.reason ?? 'Cancelled by operator'))
      return NextResponse.json({ ok: true, operation, action })
    }

    return NextResponse.json({ ok: false, error: 'Unknown operation. Use prepare, approve, claim, complete, or cancel.' }, { status: 400 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Revenue approval operation failed.'
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
