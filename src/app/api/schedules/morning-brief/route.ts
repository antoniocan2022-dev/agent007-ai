/**
 * /api/schedules/morning-brief — UPGRADE #209
 *
 * Vercel Cron trigger for the Morning Executive Brief.
 * Schedule: 0 9 * * * (every day at 9AM UTC)
 *
 * This endpoint is public (no auth) because Vercel Cron can't authenticate.
 * It only runs the brief — doesn't expose any sensitive data.
 */
import { NextResponse } from 'next/server'
import { runMorningBrief } from '@/lib/autonomous-strategic-planner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET() {
  const result = await runMorningBrief()
  return NextResponse.json({
    ok: result.ok,
    sent: result.sent,
    timestamp: new Date().toISOString(),
    error: result.error,
  })
}
