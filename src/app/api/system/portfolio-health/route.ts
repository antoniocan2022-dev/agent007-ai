/**
 * /api/system/portfolio-health — financial safety backstop.
 *
 * GET is read-only metadata. POST performs the mutating health sweep.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { checkPortfolioHealth } from '@/lib/business-portfolio'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET() {
  return NextResponse.json({ ok: true, mode: 'read_only', execution: 'Use authenticated POST to run the portfolio safety sweep.' })
}

export async function POST(_req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const result = await checkPortfolioHealth()
  return NextResponse.json({ ok: true, ...result })
}
