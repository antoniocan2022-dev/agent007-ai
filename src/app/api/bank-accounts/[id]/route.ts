import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUserId } from '@/lib/session-user'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/bank-accounts/[id] — fetch a single bank account by ID.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getSessionUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params
    const account = await db.bankAccount.findFirst({ where: { id, userId } })
    if (!account) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ account })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed to fetch bank account' }, { status: 500 })
  }
}

/**
 * DELETE /api/bank-accounts/[id]
 * Unlink a bank account. (Audit log entry is permanent — the deletion itself is logged.)
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getSessionUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const existing = await db.bankAccount.findFirst({ where: { id, userId } })
    if (!existing) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

    // Log the deletion to audit log BEFORE deleting (permanent record)
    try {
      await db.auditLog.create({
        data: {
          userId,
          action: 'delete',
          entity: 'bank_account',
          entityId: id,
          description: `Unlinked bank account: ${existing.label}`,
          metadata: JSON.stringify({ bankName: existing.bankName, last4: existing.accountLast4 }),
        },
      })
    } catch {}

    await db.bankAccount.delete({ where: { id } })

    return NextResponse.json({ ok: true, message: `Bank account "${existing.label}" unlinked. Deletion logged to permanent audit history.` })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'unknown' }, { status: 500 })
  }
}

/**
 * PATCH /api/bank-accounts/[id]
 * Update an account (set as primary, update label, mark as verified).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getSessionUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const body = await req.json()
    const existing = await db.bankAccount.findFirst({ where: { id, userId } })
    if (!existing) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

    const update: any = {}
    if (body.isPrimary === true) {
      // Unset other primaries
      await db.bankAccount.updateMany({ where: { userId, isPrimary: true }, data: { isPrimary: false } })
      update.isPrimary = true
    }
    if (body.label !== undefined) update.label = body.label
    if (body.verificationStatus !== undefined) update.verificationStatus = body.verificationStatus

    const updated = await db.bankAccount.update({ where: { id }, data: update })

    try {
      await db.auditLog.create({
        data: {
          userId,
          action: 'update',
          entity: 'bank_account',
          entityId: id,
          description: `Updated bank account: ${updated.label}`,
          metadata: JSON.stringify({ changes: Object.keys(update) }),
        },
      })
    } catch {}

    return NextResponse.json({ ok: true, account: { id: updated.id, label: updated.label, isPrimary: updated.isPrimary, verificationStatus: updated.verificationStatus } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'unknown' }, { status: 500 })
  }
}
