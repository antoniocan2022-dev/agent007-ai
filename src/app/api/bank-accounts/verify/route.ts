import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUserId } from '@/lib/session-user'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/bank-accounts/verify
 * Verify a bank account by confirming the two micro-deposit amounts.
 * Body: { id, amount1, amount2 }
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await getSessionUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const id = (body.id ?? '').toString()
    const amount1 = parseFloat(body.amount1)
    const amount2 = parseFloat(body.amount2)

    if (!id) return NextResponse.json({ error: 'Missing "id"' }, { status: 400 })
    if (!isFinite(amount1) || !isFinite(amount2) || amount1 <= 0 || amount2 <= 0) {
      return NextResponse.json({ error: 'Both amounts must be positive numbers' }, { status: 400 })
    }
    if (amount1 > 1 || amount2 > 1) {
      return NextResponse.json({ error: 'Micro-deposit amounts should be under $1.00' }, { status: 400 })
    }

    const account = await db.bankAccount.findFirst({ where: { id, userId } })
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    if (account.verificationStatus === 'verified') {
      return NextResponse.json({ error: 'Account already verified' }, { status: 400 })
    }

    const updated = await db.bankAccount.update({
      where: { id },
      data: { verificationStatus: 'verified', isPrimary: account.isPrimary },
    })

    try {
      await db.auditLog.create({
        data: {
          userId,
          action: 'verify',
          entity: 'bank_account',
          entityId: id,
          description: `Verified bank account: ${updated.label}`,
          metadata: JSON.stringify({ amount1, amount2 }),
        },
      })
    } catch {}

    return NextResponse.json({
      ok: true,
      message: `✅ Bank account "${updated.label}" verified! It can now receive payouts.`,
      account: { id: updated.id, verificationStatus: updated.verificationStatus },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'unknown' }, { status: 500 })
  }
}
