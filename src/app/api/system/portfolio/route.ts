/**
 * /api/system/portfolio — canonical Business Portfolio endpoint.
 *
 * Portfolio data and mutations are authenticated system operations. New venture
 * creation is routed through Venture OS so duplicate business names cannot be
 * registered through this API.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getPortfolio, getActiveBusinesses, updateBusiness, retireBusiness, computeEnterpriseValue, type BusinessType } from '@/lib/business-portfolio'
import { createVenture } from '@/lib/venture-os'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

async function requireSession() {
  const session = await getServerSession(authOptions)
  return session?.user ? null : NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
}

export async function GET(req: NextRequest) {
  const denied = await requireSession()
  if (denied) return denied
  const url = new URL(req.url)
  const activeOnly = url.searchParams.get('active') === 'true'
  const valueOnly = url.searchParams.get('value') === 'true'
  if (valueOnly) return NextResponse.json({ ok: true, ...(await computeEnterpriseValue()) })
  const businesses = activeOnly ? await getActiveBusinesses() : await getPortfolio()
  return NextResponse.json({ ok: true, count: businesses.length, businesses })
}

export async function POST(req: NextRequest) {
  const denied = await requireSession()
  if (denied) return denied
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }) }
  const { name, type, description, targetMarket, pricingModel } = body ?? {}
  if (typeof name !== 'string' || !name.trim() || typeof type !== 'string' || !description) return NextResponse.json({ ok: false, error: 'Missing fields: name, type, description required' }, { status: 400 })

  const result = await createVenture({ name, type: type as BusinessType, description, targetMarket, pricingModel })
  if (result.duplicate) return NextResponse.json({ ok: false, duplicate: true, error: result.reason || 'A venture with this name already exists.', business: result.business }, { status: 409 })
  if (!result.business) return NextResponse.json({ ok: false, error: result.reason || 'Venture creation failed.' }, { status: 500 })
  return NextResponse.json({ ok: true, created: result.created, ...result.business }, { status: result.created ? 201 : 200 })
}

export async function PATCH(req: NextRequest) {
  const denied = await requireSession()
  if (denied) return denied
  const businessId = new URL(req.url).searchParams.get('id')
  if (!businessId) return NextResponse.json({ ok: false, error: 'Missing ?id= parameter' }, { status: 400 })
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }) }
  const updated = await updateBusiness(businessId, body)
  return NextResponse.json({ ok: !!updated, ...(updated || {}) }, { status: updated ? 200 : 404 })
}

export async function DELETE(req: NextRequest) {
  const denied = await requireSession()
  if (denied) return denied
  const businessId = new URL(req.url).searchParams.get('id')
  if (!businessId) return NextResponse.json({ ok: false, error: 'Missing ?id= parameter' }, { status: 400 })
  let body: any = {}
  try { body = await req.json() } catch {}
  const reason = typeof body?.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'Portfolio retirement requested.'
  const existing = (await getPortfolio()).find((business) => business.businessId === businessId)
  if (!existing) return NextResponse.json({ ok: false, error: 'Business not found.' }, { status: 404 })
  await retireBusiness(businessId, reason)
  return NextResponse.json({ ok: true, message: `Business ${businessId} retired: ${reason}` })
}
