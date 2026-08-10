import { NextRequest, NextResponse } from 'next/server'
import { sendMorningBrief } from '@/lib/ceo-executive-communications'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const result = await sendMorningBrief()
  return NextResponse.json({ ok: result.sent || result.skipped === true, ...result, timestamp: new Date().toISOString() })
}
