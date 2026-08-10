import { NextRequest, NextResponse } from 'next/server'
import { runQaMonitor, pickQaTier } from '@/lib/monitor-agents'
import { sendCriticalCEOEscalation } from '@/lib/ceo-executive-communications'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  try {
    const tier = pickQaTier(new Date())
    const report = await runQaMonitor({ tier })
    const criticalEscalation = await sendCriticalCEOEscalation(report)
    return NextResponse.json({ ok: true, tier, ...report, criticalEscalation })
  } catch (e: any) {
    console.error('[monitor/qa] GET failed:', e)
    return NextResponse.json({ ok: false, error: e?.message ?? 'QA monitor failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const tier = ([1, 2, 3, 4].includes(body?.tier) ? body.tier : pickQaTier(new Date())) as 1 | 2 | 3 | 4
    const report = await runQaMonitor({ tier })
    const criticalEscalation = await sendCriticalCEOEscalation(report)
    return NextResponse.json({ ok: true, tier, ...report, criticalEscalation })
  } catch (e: any) {
    console.error('[monitor/qa] POST failed:', e)
    return NextResponse.json({ ok: false, error: e?.message ?? 'QA monitor failed' }, { status: 500 })
  }
}
