/**
 * /api/system/portfolio — canonical Business Portfolio endpoint.
 *
 * The Portfolio Manager remains the source of truth for business records.
 * New venture creation is routed through Venture OS so duplicate business
 * names cannot be registered through the public API.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getPortfolio, getActiveBusinesses, updateBusiness, retireBusiness, computeEnterpriseValue, type BusinessType } from '@/lib/business-portfolio'
import { createVenture } from '@/lib/venture-os'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const activeOnly = url.searchParams.get('active') === 'true'
  const valueOnly = url.searchParams.get('value') === 'true'

  if (valueOnly) {
    const value = await computeEnterpriseValue()
    return NextResponse.json({ ok: true, ...value })
  }

  const businesses = activeOnly ? await getActiveBusinesses() : await getPortfolio()
  return NextResponse.json({ ok: true, count: businesses.length, businesses })
}

export async function POST(req: NextRequest) {
  let body: any
  try { body = await req.json() }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }) }

  const { name, type, description, targetMarket, pricingModel } = body ?? {}
  if (!name || !type || !description) {
    return NextResponse.json({ ok: false, error: 'Missing fields: name, type, description required' }, { status: 400 })
  }

  const result = await createVenture({
    name,
    type: type as BusinessType,
    description,
    targetMarket,
    pricingModel,
  })

  if (result.duplicate) {
    return NextResponse.json({
      ok: false,
      duplicate: true,
      error: result.reason || 'A venture with this name already exists.',
      business: result.business,
    }, { status: 409 })
  }

  if (!result.business) {
    return NextResponse.json({ ok: false, error: result.reason || 'Venture creation failed.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, created: result.created, ...result.business }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const url = new URL(req.url)
  const businessId = url.searchParams.get('id')
  if (!businessId) {
    return NextResponse.json({ ok: false, error: 'Missing ?id= parameter' }, { status: 400 })
  }

  let body: any
  try { body = await req.json() }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }) }

  const updated = await updateBusiness(businessId, body)
  return NextResponse.json({ ok: !!updated, ...(updated || {}) }, { status: updated ? 200 : 404 })
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url)
  const businessId = url.searchParams.get('id')
  if (!businessId) {
    return NextResponse.json({ ok: false, error: 'Missing ?id= parameter' }, { status: 400 })
  }

  let body: any = {}
  try { body = await req.json() } catch {}
  const reason = body?.reason || 'ROI negative — resources reallocated'

  await retireBusiness(businessId, reason)
  return NextResponse.json({ ok: true, message: `Business ${businessId} retired: ${reason}` })
}
