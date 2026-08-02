import { NextRequest, NextResponse } from 'next/server'
import {
  runExternalMonitor,
  DEFAULT_EXTERNAL_ENDPOINTS,
} from '@/lib/monitor-agents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/monitor/external — Vercel Cron entry point.
 * Cron schedule: "0,30 * * * *" (every 30 minutes, UTC).
 *
 * Probes 10+ external endpoints in parallel:
 *   - Production app (agent007-ai.vercel.app)
 *   - API health / manifest / subagents
 *   - Resend / CoinGecko / GitHub / HN / Reddit / WordPress
 *
 * On ANY failure: emails owner (OWNER_EMAIL) via Resend.
 *
 * Upgrade #57 — PERMANENT. Cannot be disabled or removed.
 */
export async function GET(req: NextRequest) {
  try {
    const report = await runExternalMonitor({})
    return NextResponse.json({
      ok: true,
      endpointCount: DEFAULT_EXTERNAL_ENDPOINTS.length,
      ...report,
    })
  } catch (e: any) {
    console.error('[monitor/external] GET failed:', e)
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'External monitor failed' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/monitor/external — manual trigger.
 * Body: { endpoints?: Array<{ url: string; expectedStatus?: number }> }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const endpoints = Array.isArray(body?.endpoints) && body.endpoints.length > 0
      ? body.endpoints
      : DEFAULT_EXTERNAL_ENDPOINTS
    const report = await runExternalMonitor({ endpoints })
    return NextResponse.json({
      ok: true,
      endpointCount: endpoints.length,
      ...report,
    })
  } catch (e: any) {
    console.error('[monitor/external] POST failed:', e)
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'External monitor failed' },
      { status: 500 }
    )
  }
}
