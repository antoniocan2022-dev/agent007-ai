/**
 * POST /api/missions/[id]/approve — UPGRADE #140 + #147 (Rec 7 + Rec A)
 * Owner approves or rejects a high-stakes mission.
 *
 * Body: { decision: 'approve' | 'reject', reason?: string }
 *
 * This endpoint is used by:
 *   - The dashboard "Approve" / "Reject" buttons
 *   - The Telegram /approve_XXX and /reject_XXX commands (via /api/commands/inbound)
 *
 * UPGRADE #147 (Rec A — Resume Trigger) — When the owner APPROVES a paused
 * high-stakes mission, this endpoint NOW immediately calls resumeMissionPipeline()
 * to actually finish the mission (run the CEO stage and produce the final report).
 * Before: approval was recorded but nothing resumed the mission — it stayed
 * stuck in 'paused_owner' state forever.
 *
 * The resume runs in the BACKGROUND so the API response is immediate (within
 * Vercel's 60s timeout). The dashboard polls /api/missions/[id]/heartbeat for
 * live progress.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import {
  markOwnerApproved,
  markOwnerRejected,
} from '@/lib/approval-audit-log'
import { notifyTelegram } from '@/lib/mission-notifier'

export const dynamic = 'force-dynamic'
export const maxDuration = 60  // UPGRADE #147 — increased from 10s to allow resume kick-off

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession()
    if (!session?.user) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { id: missionId } = await params
    if (!missionId) {
      return NextResponse.json({ ok: false, error: 'Mission ID required' }, { status: 400 })
    }

    const body = await req.json().catch(() => ({}))
    const decision = body.decision === 'reject' ? 'reject' : 'approve'
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 500) : undefined

    if (decision === 'approve') {
      await markOwnerApproved(missionId, reason)
      await notifyTelegram(`✅ OWNER APPROVED mission ${missionId}${reason ? `\nNotes: ${reason}` : ''}\n\nResuming the mission now — the CEO will prepare the final report shortly.`)

      // UPGRADE #147 (Rec A — Resume Trigger) — Kick off the resume in the background.
      // We don't await it because it can take minutes (CEO LLM call), and Vercel
      // kills requests after 60s. The dashboard polls /heartbeat for live progress.
      //
      // We use a dynamic import to avoid loading the pipeline module on every
      // request (it's heavy). The resume is fire-and-forget — errors are logged
      // to the audit trail by the pipeline itself.
      try {
        const { resumeMissionPipeline } = await import('@/lib/mission-pipeline')
        // Fire-and-forget — don't await
        resumeMissionPipeline(missionId).catch((resumeErr: any) => {
          console.error(`[missions/${missionId}/approve] Resume failed:`, resumeErr?.message?.slice(0, 200))
          // Log to audit trail so the owner can see why the resume failed
          import('@/lib/approval-audit-log').then(({ logApprovalEvent }) =>
            logApprovalEvent({
              missionId,
              stageId: 'resume',
              round: 1,
              agentRole: 'system',
              agentId: 'system',
              action: 'failed',
              feedback: `Resume failed after owner approval: ${resumeErr?.message?.slice(0, 200) ?? 'unknown'}`,
            })
          ).catch(() => {})
        })
      } catch (importErr: any) {
        console.error(`[missions/${missionId}/approve] Failed to load resumeMissionPipeline:`, importErr?.message?.slice(0, 200))
      }

      return NextResponse.json({
        ok: true,
        decision: 'approve',
        missionId,
        resumeTriggered: true,  // UPGRADE #147 — UI can show "Resuming..." message
      })
    } else {
      await markOwnerRejected(missionId, reason)
      await notifyTelegram(`❌ OWNER REJECTED mission ${missionId}${reason ? `\nReason: ${reason}` : ''}\n\nThe mission will be marked as failed.`)

      // UPGRADE #147 — Mark the mission as failed in the heartbeat so the
      // dashboard shows the correct final state
      try {
        const { loadHeartbeat, saveHeartbeat } = await import('@/lib/mission-heartbeat')
        const hb = await loadHeartbeat(missionId)
        if (hb) {
          hb.status = 'failed'
          hb.lastError = `Owner rejected the mission: ${reason ?? 'no reason given'}`
          hb.ceoWatchdog = {
            verdict: 'critical',
            message: 'Owner rejected the mission',
            checkedAt: new Date().toISOString(),
          }
          hb.updatedAt = new Date().toISOString()
          await saveHeartbeat(hb)
        }
      } catch {}

      return NextResponse.json({ ok: true, decision: 'reject', missionId })
    }
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'Unknown error' },
      { status: 500 }
    )
  }
}

