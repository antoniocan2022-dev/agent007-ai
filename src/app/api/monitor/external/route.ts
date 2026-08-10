import { NextRequest, NextResponse } from 'next/server'
import { runExternalMonitor, DEFAULT_EXTERNAL_ENDPOINTS } from '@/lib/monitor-agents'
import { sendCriticalCEOEscalation } from '@/lib/ceo-executive-communications'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim()
  return !!secret && req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  try {
    const report = await runExternalMonitor({})
    const criticalEscalation = await sendCriticalCEOEscalation(report)
    return NextResponse.json({ ok: true, endpointCount: DEFAULT_EXTERNAL_ENDPOINTS.length, ...report, criticalEscalation })
  } catch (e: any) {
    console.error('[monitor/external] GET failed:', e)
    return NextResponse.json({ ok: false, error: e?.message ?? 'External monitor failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await req.json().catch(() => ({}))
    const endpoints = Array.isArray(body?.endpoints) && body.endpoints.length > 0 ? body.endpoints : DEFAULT_EXTERNAL_ENDPOINTS
    const report = await runExternalMonitor({ endpoints })
    const criticalEscalation = await sendCriticalCEOEscalation(report)
    return NextResponse.json({ ok: true, endpointCount: endpoints.length, ...report, criticalEscalation })
  } catch (e: any) {
    console.error('[monitor/external] POST failed:', e)
    return NextResponse.json({ ok: false, error: e?.message ?? 'External monitor failed' }, { status: 500 })
  }
}
