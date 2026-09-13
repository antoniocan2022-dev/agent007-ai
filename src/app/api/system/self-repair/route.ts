/**
 * /api/system/self-repair — governed self-repair pipeline.
 *
 * GET ?cycle=true scans recent incidents and runs one governed self-repair cycle: low-risk, validated
 * corrections are activated autonomously; everything else (high-risk domains, or a low-risk category
 * with no wired classifier hook yet) is left `awaiting_approval` for a human. GET with no query returns
 * the current pending queue. POST is the explicit human approval/rejection surface for the
 * `awaiting_approval` queue -- mirrors /api/system/evolution's own approve/apply/resolve pattern.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { approveSelfRepairPattern, getLearnedPatternById, listPendingSelfRepairPatterns, rejectSelfRepairPattern, runGovernedSelfRepairCycle } from '@/lib/ceo-self-repair-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function requireSession() {
  const session = await getServerSession(authOptions)
  return session?.user ? session : null
}

export async function GET(req: NextRequest) {
  if (!await requireSession()) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const cycleMode = url.searchParams.get('cycle') === 'true'
  const windowHoursParam = url.searchParams.get('windowHours')
  const windowHours = windowHoursParam ? Math.max(1, Math.min(24 * 30, Number(windowHoursParam) || 24 * 7)) : undefined
  if (cycleMode) return NextResponse.json({ ok: true, ...(await runGovernedSelfRepairCycle(windowHours)) })
  const pending = await listPendingSelfRepairPatterns(100)
  return NextResponse.json({ ok: true, count: pending.length, pending })
}

export async function POST(req: NextRequest) {
  const session = await requireSession()
  if (!session) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const action = typeof body.action === 'string' ? body.action.trim().toLowerCase() : ''
  const patternId = typeof body.patternId === 'string' ? body.patternId.trim() : ''
  if (!patternId) return NextResponse.json({ ok: false, error: 'patternId is required' }, { status: 400 })
  const approver = typeof session.user?.email === 'string' ? session.user.email : 'owner'
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'Explicit owner decision'
  try {
    if (action === 'approve') return NextResponse.json({ ok: true, pattern: await approveSelfRepairPattern(patternId, approver, reason) })
    if (action === 'reject') return NextResponse.json({ ok: true, pattern: await rejectSelfRepairPattern(patternId, approver, reason) })
    const pattern = await getLearnedPatternById(patternId)
    return NextResponse.json({ ok: Boolean(pattern), pattern }, { status: pattern ? 200 : 404 })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
