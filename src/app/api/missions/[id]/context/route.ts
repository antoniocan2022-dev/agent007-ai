import { NextResponse } from 'next/server'
import { resolveMissionContext } from '@/lib/mission-context-resolver'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const resolved = await resolveMissionContext(id)
    return NextResponse.json({ ok: true, context: resolved }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = message.startsWith('MISSION_NOT_FOUND') ? 404 : 400
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
