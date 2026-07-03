import { NextResponse } from 'next/server'
import { getAllCustomSettings, setCustomSetting } from '@/lib/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/system/refresh
 *   Returns the latest "refresh signal" timestamp. Clients poll this
 *   to know when to reload their data (dashboard, settings, etc.).
 *   Also returns all custom settings so clients can pick up UI changes
 *   made by Agent007.
 *
 * POST /api/system/refresh
 *   Body: { reason?: string }
 *   Triggers a refresh signal — bumps the timestamp so polling clients
 *   know they need to re-fetch data. Agent007 calls this after any
 *   settings/dashboard modification.
 */
export async function GET() {
  const custom = (await getAllCustomSettings().catch(() => ({}))) as Record<string, any>
  const lastRefreshInfo = custom.__lastRefresh
  const lastRefresh = (typeof lastRefreshInfo === 'string'
    ? lastRefreshInfo
    : lastRefreshInfo?.ts) ?? new Date(0).toISOString()
  return NextResponse.json({
    lastRefresh,
    custom,
    timestamp: new Date().toISOString(),
  })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const reason = (body.reason as string | undefined) ?? 'manual'
  const now = new Date().toISOString()
  await setCustomSetting('__lastRefresh', { ts: now, reason })
  return NextResponse.json({
    ok: true,
    lastRefresh: now,
    reason,
    message: `Refresh signal emitted at ${now}. Polling clients will reload on next poll.`,
  })
}
