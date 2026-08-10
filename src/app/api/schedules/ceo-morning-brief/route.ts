import { NextResponse } from 'next/server'
import { sendMorningBrief } from '@/lib/ceo-executive-communications'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const result = await sendMorningBrief()
  return NextResponse.json({ ok: result.sent, ...result, timestamp: new Date().toISOString() })
}
