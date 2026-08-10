import { NextRequest, NextResponse } from 'next/server'
import { runExternalMonitor, DEFAULT_EXTERNAL_ENDPOINTS } from '@/lib/monitor-agents'
import { sendCriticalCEOEscalation } from '@/lib/ceo-executive-communications'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
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
