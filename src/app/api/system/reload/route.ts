import { NextResponse } from 'next/server'
import { getAllCustomSettings, setCustomSetting } from '@/lib/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/system/reload
 *   Returns the latest "reload signal" timestamp. Clients poll this
 *   to know when to do a full page reload (window.location.reload()).
 *
 * POST /api/system/reload
 *   Body: { reason?: string }
 *   Triggers a reload signal — bumps the timestamp so polling clients
 *   will do a full page reload. Use this when Agent007 modifies code,
 *   login page branding, or any structural change that requires a
 *   full reload (not just data refresh).
 */
export async function GET() {
  const custom = (await getAllCustomSettings().catch(() => ({}))) as Record<string, any>
  const reloadInfo = custom.__lastReload as { ts?: string; reason?: string } | undefined
  const lastReload = reloadInfo?.ts ?? new Date(0).toISOString()
  const lastReloadReason = reloadInfo?.reason ?? ''
  return NextResponse.json({
    lastReload,
    lastReloadReason,
    timestamp: new Date().toISOString(),
  })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const reason = (body.reason as string | undefined) ?? 'manual'
  const now = new Date().toISOString()
  await setCustomSetting('__lastReload', { ts: now, reason })
  return NextResponse.json({
    ok: true,
    lastReload: now,
    reason,
    message: `Reload signal emitted at ${now}. Polling clients will do a full page reload on next poll.`,
  })
}
