import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUserId } from '@/lib/session-user'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/paypal-accounts/[id] — fetch a single PayPal account by ID. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getSessionUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params
    const account = await db.payPalAccount.findFirst({ where: { id, userId } })
    if (!account) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ account })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed to fetch PayPal account' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getSessionUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const existing = await db.payPalAccount.findFirst({ where: { id, userId } })
    if (!existing) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

    try {
      await db.auditLog.create({
        data: {
          userId,
          action: 'delete',
          entity: 'paypal_account',
          entityId: id,
          description: `Unlinked PayPal account: ${existing.email}`,
        },
      })
    } catch {}

    await db.payPalAccount.delete({ where: { id } })
    return NextResponse.json({ ok: true, message: `PayPal account "${existing.email}" unlinked. Deletion logged.` })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'unknown' }, { status: 500 })
  }
}
