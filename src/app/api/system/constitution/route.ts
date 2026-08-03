/**
 * /api/system/constitution — UPGRADE #224
 *
 * Returns the Organizational Constitution — the 7 permanent principles.
 *
 * GET /api/system/constitution → list all principles
 * POST /api/system/constitution/check → check a response against constitution
 *   Body: { response: "..." }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getConstitution, checkResponseConstitution } from '@/lib/organizational-constitution'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const principles = getConstitution()
  return NextResponse.json({
    ok: true,
    count: principles.length,
    principles,
  })
}

export async function POST(req: NextRequest) {
  let body: any
  try { body = await req.json() }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }) }

  const { response } = body ?? {}
  if (!response) {
    return NextResponse.json({ ok: false, error: 'Missing "response" field' }, { status: 400 })
  }

  const result = checkResponseConstitution(response)
  return NextResponse.json({ ok: true, ...result })
}
