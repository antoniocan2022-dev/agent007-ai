/**
 * POST /api/missions/[id]/approve — UPGRADE #140 (Rec 7)
 * Owner approves or rejects a high-stakes mission.
 *
 * Body: { decision: 'approve' | 'reject', reason?: string }
 *
 * This endpoint is used by:
 *   - The dashboard "Approve" / "Reject" buttons
 *   - The Telegram /approve_XXX and /reject_XXX commands (via /api/commands/inbound)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import {
  markOwnerApproved,
  markOwnerRejected,
} from '@/lib/approval-audit-log'
import { notifyTelegram } from '@/lib/mission-notifier'

export const dynamic = 'force-dynamic'
export const maxDuration = 10

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession()
    if (!session?.user) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const missionId = params.id
    if (!missionId) {
      return NextResponse.json({ ok: false, error: 'Mission ID required' }, { status: 400 })
    }

    const body = await req.json().catch(() => ({}))
    const decision = body.decision === 'reject' ? 'reject' : 'approve'
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 500) : undefined

    if (decision === 'approve') {
      await markOwnerApproved(missionId, reason)
      await notifyTelegram(`✅ OWNER APPROVED mission ${missionId}${reason ? `\nNotes: ${reason}` : ''}`)
      return NextResponse.json({ ok: true, decision: 'approve', missionId })
    } else {
      await markOwnerRejected(missionId, reason)
      await notifyTelegram(`❌ OWNER REJECTED mission ${missionId}${reason ? `\nReason: ${reason}` : ''}`)
      return NextResponse.json({ ok: true, decision: 'reject', missionId })
    }
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'Unknown error' },
      { status: 500 }
    )
  }
}
