/**
 * /api/system/portfolio — UPGRADE #228
 *
 * Business Portfolio Manager endpoint.
 *
 * GET /api/system/portfolio → all businesses
 * GET /api/system/portfolio?active=true → active businesses only
 * GET /api/system/portfolio?value=true → Enterprise Value (North Star)
 * POST /api/system/portfolio → create new business
 *   Body: { name, type, description, targetMarket, pricingModel }
 * PATCH /api/system/portfolio?id=biz_xxx → update business
 * DELETE /api/system/portfolio?id=biz_xxx → retire business
 *   Body: { reason }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getPortfolio, getActiveBusinesses, createBusiness, updateBusiness, retireBusiness, computeEnterpriseValue, type BusinessType } from '@/lib/business-portfolio'

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

  const business = await createBusiness({ name, type: type as BusinessType, description, targetMarket, pricingModel })
  return NextResponse.json({ ok: true, ...business })
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
  return NextResponse.json({ ok: !!updated, ...(updated || {}) })
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
