import { NextResponse } from 'next/server'
import { getLiveSystemHealth } from '@/lib/system-health-telemetry'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const report = await getLiveSystemHealth()
  return NextResponse.json(
    {
      ok: report.overall !== 'failed',
      status: report.overall,
      timestamp: report.generatedAt,
      app: 'Agent007 AI',
      url: 'https://agent007-ai.vercel.app',
      region: process.env.VERCEL_REGION ?? 'iad1',
      uptime_seconds: Math.round(process.uptime()),
      runtime: 'nodejs',
      manifest: report.release,
      checks: report.checks,
    },
    { headers: { 'cache-control': 'no-store' }, status: report.overall === 'failed' ? 503 : 200 },
  )
}
