import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET() {
  const u = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!u) return NextResponse.json({ profile: null })
  let p = await db.riskProfile.findFirst({ where: { userId: u.id } })
  if (!p) p = await db.riskProfile.create({ data: { userId: u.id } })
  return NextResponse.json({ profile: p })
}
export async function POST(req: NextRequest) {
  const u = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!u) return NextResponse.json({ error: 'No user' }, { status: 500 })
  const b = await req.json().catch(() => ({}))
  let p = await db.riskProfile.findFirst({ where: { userId: u.id } })
  if (p) p = await db.riskProfile.update({ where: { id: p.id }, data: { riskTolerance: b.riskTolerance, maxInvestment: b.maxInvestment, timeHorizon: b.timeHorizon, preferredMarkets: b.preferredMarkets, avoidCategories: b.avoidCategories } })
  else p = await db.riskProfile.create({ data: { userId: u.id, riskTolerance: b.riskTolerance || 'moderate', maxInvestment: b.maxInvestment || 5000, timeHorizon: b.timeHorizon || 'medium', preferredMarkets: b.preferredMarkets || 'US,CA', avoidCategories: b.avoidCategories } })
  return NextResponse.json({ ok: true, profile: p })
}
