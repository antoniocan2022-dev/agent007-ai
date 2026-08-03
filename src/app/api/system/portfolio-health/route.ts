/**
 * /api/system/portfolio-health — UPGRADE #231
 *
 * Checks all active businesses for negative ROI and auto-retires failing ones.
 *
 * GET /api/system/portfolio-health → check portfolio health + auto-retire
 */
import { NextResponse } from 'next/server'
import { checkPortfolioHealth } from '@/lib/business-portfolio'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET() {
  const result = await checkPortfolioHealth()
  return NextResponse.json({ ok: true, ...result })
}
