import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/health
 *
 * Public health check endpoint (no auth required).
 *
 * Used by:
 *   - External Monitor (external_uptime_monitor) — probes this URL every 30 min
 *   - Vercel Cron health checks
 *   - External uptime monitors (uptime robot, pingdom, etc.)
 *   - Docker/K8s liveness probes (if containerized)
 *
 * Returns:
 *   {
 *     "ok": true,
 *     "status": "healthy",
 *     "timestamp": "2026-07-12T13:45:00.000Z",
 *     "version": "upgrade-58",
 *     "app": "Agent007 AI",
 *     "url": "https://agent007-ai.vercel.app",
 *     "region": "iad1",
 *     "uptime_seconds": 123.45
 *   }
 *
 * Upgrade #58 — PERMANENT.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: 'upgrade-205',  // UPGRADE #205: private authenticated backup download (no public files)
    app: 'Agent007 AI',
    url: 'https://agent007-ai.vercel.app',
    region: process.env.VERCEL_REGION ?? 'iad1',
    uptime_seconds: Math.round(process.uptime()),
    runtime: 'nodejs',
  })
}
