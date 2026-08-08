import { NextResponse } from 'next/server'
import { inspectRecoverySchema } from '@/lib/dr-schema-bootstrap'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Read-only DR schema inspection. Schema mutation is deliberately not exposed here. */
export async function GET() {
  try {
    return NextResponse.json({ ok: true, ...(await inspectRecoverySchema()) })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? 'Recovery schema unavailable' }, { status: 503 })
  }
}
