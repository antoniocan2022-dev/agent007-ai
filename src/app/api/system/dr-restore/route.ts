import { NextRequest, NextResponse } from 'next/server'
import { inspectRecoveryTarget, restoreBackupToRecovery } from '@/lib/dr-recovery'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Isolated disaster-recovery endpoint.
 * Real restores can ONLY target AGENT007_DR_DATABASE_URL.
 * The existing production database connection is never used here.
 */
export async function GET() {
  try {
    return NextResponse.json({ ok: true, ...(await inspectRecoveryTarget()) })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? 'Recovery target unavailable' }, { status: 503 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const backup = body?.backup ?? body
    const dryRun = body?.dryRun !== false
    const result = await restoreBackupToRecovery(backup, dryRun)
    return NextResponse.json({ ok: true, ...result }, { status: 200 })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? 'Recovery restore failed' }, { status: 400 })
  }
}
