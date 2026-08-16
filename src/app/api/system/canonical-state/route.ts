import { NextResponse } from 'next/server'
import { getCanonicalOrganizationalState, validateCanonicalOrganizationalState } from '@/lib/canonical-organizational-state'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const state = getCanonicalOrganizationalState()
  const errors = validateCanonicalOrganizationalState(state)
  return NextResponse.json({ ok: errors.length === 0, state, errors })
}
