/**
 * /api/system/audit-engine — UPGRADE #219
 *
 * Executive Audit Engine endpoint.
 * Returns recent audit reports + aggregate audit metrics.
 *
 * GET /api/system/audit-engine → recent reports
 * GET /api/system/audit-engine?metrics=true → aggregate metrics
 */
import { NextRequest, NextResponse } from 'next/server'
import { getRecentAuditReports, getAuditMetrics } from '@/lib/executive-audit-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const metricsOnly = url.searchParams.get('metrics') === 'true'
  const limit = parseInt(url.searchParams.get('limit') || '20')

  if (metricsOnly) {
    const metrics = await getAuditMetrics()
    return NextResponse.json({ ok: true, ...metrics })
  }

  const reports = await getRecentAuditReports(limit)
  return NextResponse.json({
    ok: true,
    count: reports.length,
    reports,
  })
}
