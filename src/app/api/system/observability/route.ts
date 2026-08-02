/**
 * /api/system/observability — UPGRADE #218
 *
 * Returns aggregate observability metrics across all missions.
 * GET /api/system/observability → aggregate dashboard data
 */
import { NextResponse } from 'next/server'
import { getObservabilityMetrics } from '@/lib/mission-telemetry'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET() {
  const metrics = await getObservabilityMetrics()
  return NextResponse.json({ ok: true, ...metrics })
}
