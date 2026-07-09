import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET() {
  const u = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!u) return NextResponse.json({ opportunities: [] })
  const ops = await db.opportunity.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' }, take: 50 })
  return NextResponse.json({ opportunities: ops })
}
export async function POST(req: NextRequest) {
  const u = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!u) return NextResponse.json({ error: 'No user' }, { status: 500 })
  const b = await req.json().catch(() => ({}))
  const op = await db.opportunity.create({ data: { userId: u.id, title: b.title || 'Untitled', description: b.description || '', category: b.category || 'other', source: b.source || 'manual', url: b.url, potential: b.potential, riskScore: b.riskScore || 5, estIncome: b.estIncome } })
  return NextResponse.json({ ok: true, id: op.id })
}
export async function DELETE(req: NextRequest) {
  const u = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!u) return NextResponse.json({ error: 'No user' }, { status: 500 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  await db.opportunity.deleteMany({ where: { id, userId: u.id } })
  return NextResponse.json({ ok: true })
}
