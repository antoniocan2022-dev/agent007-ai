import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET() {
  const u = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!u) return NextResponse.json({ plans: [] })
  const plans = await db.scalingPlan.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' }, take: 50 })
  return NextResponse.json({ plans })
}
export async function POST(req: NextRequest) {
  const u = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!u) return NextResponse.json({ error: 'No user' }, { status: 500 })
  const b = await req.json().catch(() => ({}))
  const plan = await db.scalingPlan.create({ data: { userId: u.id, name: b.name || 'Scaling Plan', asset: b.asset || '', currentLevel: b.currentLevel || '', targetLevel: b.targetLevel || '', strategy: b.strategy || '', timeline: b.timeline, estimatedCost: b.estimatedCost, estimatedReturn: b.estimatedReturn, riskLevel: b.riskLevel || 'medium', status: b.status || 'proposed' } })
  return NextResponse.json({ ok: true, id: plan.id })
}
export async function DELETE(req: NextRequest) {
  const u = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!u) return NextResponse.json({ error: 'No user' }, { status: 500 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  await db.scalingPlan.deleteMany({ where: { id, userId: u.id } })
  return NextResponse.json({ ok: true })
}
