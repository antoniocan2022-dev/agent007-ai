/**
 * /api/system/cross-insights — UPGRADE #231
 *
 * Cross-business knowledge sharing endpoint.
 *
 * GET /api/system/cross-insights → all cross-business insights
 * POST /api/system/cross-insights → share insights from a business
 *   Body: { businessId: "biz_xxx" }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getCrossBusinessInsights, shareBusinessInsights } from '@/lib/business-portfolio'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET() {
  const insights = await getCrossBusinessInsights(50)
  return NextResponse.json({ ok: true, count: insights.length, insights })
}

export async function POST(req: NextRequest) {
  let body: any
  try { body = await req.json() }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }) }

  const { businessId } = body ?? {}
  if (!businessId) {
    return NextResponse.json({ ok: false, error: 'Missing businessId' }, { status: 400 })
  }

  const insights = await shareBusinessInsights(businessId)
  return NextResponse.json({ ok: true, shared: insights.length, insights })
}
