import { NextRequest, NextResponse } from 'next/server'
import { runQaMonitor, pickQaTier } from '@/lib/monitor-agents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/monitor/qa — Vercel Cron entry point.
 * Cron schedule: "0 * * * *" (every hour on the hour, UTC).
 * Tier is auto-picked based on hour-of-day:
 *   h=09 → TIER 4 (24h full audit)
 *   h=21 → TIER 3 (12h deep)
 *   h=03,15 → TIER 2 (6h standard)
 *   else → TIER 1 (1h quick)
 *
 * On ANY failure: emails owner (OWNER_EMAIL) via Resend.
 *
 * Upgrade #57 — PERMANENT. Cannot be disabled or removed.
 */
export async function GET(req: NextRequest) {
  try {
    // Vercel Cron sends a CRON_HEADER — but we accept any GET for resilience.
    // The endpoint is read-only (just runs checks + emails on failure).
    const tier = pickQaTier(new Date())
    const report = await runQaMonitor({ tier })
    return NextResponse.json({
      ok: true,
      tier,
      ...report,
    })
  } catch (e: any) {
    console.error('[monitor/qa] GET failed:', e)
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'QA monitor failed' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/monitor/qa — manual trigger (owner can hit from UI / curl).
 * Body: { tier?: 1 | 2 | 3 | 4 }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const tier = ([1, 2, 3, 4].includes(body?.tier) ? body.tier : pickQaTier(new Date())) as
      | 1
      | 2
      | 3
      | 4
    const report = await runQaMonitor({ tier })
    return NextResponse.json({ ok: true, tier, ...report })
  } catch (e: any) {
    console.error('[monitor/qa] POST failed:', e)
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'QA monitor failed' },
      { status: 500 }
    )
  }
}
