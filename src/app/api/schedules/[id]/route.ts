import { NextRequest, NextResponse } from 'next/server'
import { requestOwnerAuthorization, verifyOwnerAuthorization } from '@/lib/owner-auth'
import { db } from '@/lib/db'
import { getOperatorUserId } from '@/lib/settings'
import { kickOffScheduleRun } from '../route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/** PUT /api/schedules/[id] — update a schedule. */
export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const userId = await getOperatorUserId()
    if (!userId) return NextResponse.json({ error: 'No operator user' }, { status: 500 })

    const existing = await db.schedule.findUnique({ where: { id } })
    if (!existing || existing.userId !== userId) {
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
    }

    const body = await req.json().catch(() => ({}))
    const { name, prompt, intervalMin, enabled, runNow } = body as {
      name?: string
      prompt?: string
      intervalMin?: number
      enabled?: boolean
      runNow?: boolean
    }

    const data: any = {}
    if (typeof name === 'string' && name.trim()) data.name = name.trim().slice(0, 120)
    if (typeof prompt === 'string' && prompt.trim()) data.prompt = prompt.slice(0, 4000)
    if (typeof intervalMin === 'number' && intervalMin > 0) {
      data.intervalMin = Math.min(Math.floor(intervalMin), 60 * 24 * 30)
    }
    if (typeof enabled === 'boolean') {
      data.enabled = enabled
      // Recompute nextRunAt based on enabled + interval
      if (enabled) {
        const interval = data.intervalMin ?? existing.intervalMin
        data.nextRunAt = new Date(Date.now() + interval * 60 * 1000)
      } else {
        data.nextRunAt = null
      }
    } else if (typeof intervalMin === 'number' && existing.enabled) {
      data.nextRunAt = new Date(Date.now() + intervalMin * 60 * 1000)
    }

    const updated = await db.schedule.update({ where: { id }, data })

    if (runNow === true && updated.enabled) {
      kickOffScheduleRun(id, updated.prompt, userId).catch((e) =>
        console.error('[schedules PUT] kickOffScheduleRun failed:', e)
      )
    }

    return NextResponse.json({ ok: true, schedule: updated })
  } catch (e: any) {
    console.error('[schedules PUT]', e)
    return NextResponse.json({ error: e?.message ?? 'Failed to update schedule' }, { status: 500 })
  }
}

/** DELETE /api/schedules/[id] — delete a schedule. */
// Owner authorization required for delete operations
async function checkOwnerAuth(operation: string, req: any): Promise<{ ok: boolean; error?: string }> {
  try {
    const authHeader = req.headers.get('x-owner-auth')
    if (authHeader) {
      const { authId, code } = JSON.parse(authHeader)
      const result = verifyOwnerAuthorization(authId, code)
      if (!result.ok) return { ok: false, error: result.message }
      return { ok: true }
    }
  } catch {}
  // No auth provided — request it
  const authResult = await requestOwnerAuthorization(operation)
  return { ok: false, error: 'OWNER_AUTH_REQUIRED:' + JSON.stringify(authResult) }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const userId = await getOperatorUserId()
    if (!userId) return NextResponse.json({ error: 'No operator user' }, { status: 500 })

    const existing = await db.schedule.findUnique({ where: { id } })
    if (!existing || existing.userId !== userId) {
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
    }

    await db.schedule.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error('[schedules DELETE]', e)
    return NextResponse.json({ error: e?.message ?? 'Failed to delete schedule' }, { status: 500 })
  }
}
