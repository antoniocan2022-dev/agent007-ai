/**
 * /api/system/venture-os — canonical executive Venture OS snapshot.
 *
 * Read-only. This endpoint composes existing VID, Portfolio, Flywheel, and
 * Dual Mission sources of truth; it never creates parallel state.
 */
import { NextResponse } from 'next/server'
import { getVentureOSSnapshot } from '@/lib/venture-os'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET() {
  const snapshot = await getVentureOSSnapshot()
  return NextResponse.json({ ok: snapshot.integrity.ok, ...snapshot }, {
    status: snapshot.integrity.ok ? 200 : 500,
  })
}
