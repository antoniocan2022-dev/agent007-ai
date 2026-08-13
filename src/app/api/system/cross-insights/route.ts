/**
 * /api/system/cross-insights — cross-business knowledge sharing endpoint.
 *
 * Both reads and writes are internal Venture/Portfolio operations.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getCrossBusinessInsights, shareBusinessInsights, getPortfolio } from '@/lib/business-portfolio'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

async function requireSession() {
  const session = await getServerSession(authOptions)
  return session?.user ? null : NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
}

export async function GET() {
  const denied = await requireSession()
  if (denied) return denied
  const insights = await getCrossBusinessInsights(50)
  return NextResponse.json({ ok: true, count: insights.length, insights })
}

export async function POST(req: NextRequest) {
  const denied = await requireSession()
  if (denied) return denied
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }) }
  const businessId = typeof body?.businessId === 'string' ? body.businessId.trim() : ''
  if (!businessId) return NextResponse.json({ ok: false, error: 'Missing businessId' }, { status: 400 })
  const exists = (await getPortfolio()).some((business) => business.businessId === businessId)
  if (!exists) return NextResponse.json({ ok: false, error: 'Business not found.' }, { status: 404 })
  const insights = await shareBusinessInsights(businessId)
  return NextResponse.json({ ok: true, shared: insights.length, insights })
}
