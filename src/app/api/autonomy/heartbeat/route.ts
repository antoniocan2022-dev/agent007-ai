import { NextRequest, NextResponse } from 'next/server'
import { runAutonomyManagerTick } from '@/lib/autonomy/autonomy-manager'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export function isAutonomyHeartbeatAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  return Boolean(secret && req.headers.get('authorization') === `Bearer ${secret}`)
}

export async function GET(req: NextRequest) {
  if (!isAutonomyHeartbeatAuthorized(req)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  try {
    const result = await runAutonomyManagerTick({ actorId: 'vid', maxWorkItems: 10 })
    return NextResponse.json({ ok: true, operation: 'autonomy_heartbeat', ...result }, { status: result.status === 'FAILED' ? 500 : 200 })
  } catch (error: any) {
    console.error('[autonomy/heartbeat] failed:', error)
    return NextResponse.json({ ok: false, error: error?.message ?? 'Autonomy heartbeat failed' }, { status: 500 })
  }
}
