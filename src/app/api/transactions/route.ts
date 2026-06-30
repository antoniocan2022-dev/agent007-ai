import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUserId } from '@/lib/session-user'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/transactions?limit=50&provider=stripe|paypal
 *
 * Returns the user's recent payment transactions (Stripe + PayPal).
 */
export async function GET(req: NextRequest) {
  const userId = await getSessionUserId()
  if (!userId) return NextResponse.json({ transactions: [] })

  const url = new URL(req.url)
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '50'))
  const provider = url.searchParams.get('provider') // 'stripe' | 'paypal' | undefined

  const where: any = { userId }
  if (provider) where.provider = provider

  const transactions = await db.transaction.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  const total = transactions
    .filter((t) => t.status === 'succeeded')
    .reduce((sum, t) => sum + t.amount, 0)

  return NextResponse.json({
    transactions,
    total,
    count: transactions.length,
  })
}
