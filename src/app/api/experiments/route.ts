import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET() {
  const u = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!u) return NextResponse.json({ experiments: [] })
  const exps = await db.experiment.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' }, take: 50 })
  return NextResponse.json({ experiments: exps })
}
export async function POST(req: NextRequest) {
  const u = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!u) return NextResponse.json({ error: 'No user' }, { status: 500 })
  const b = await req.json().catch(() => ({}))
  const exp = await db.experiment.create({ data: { userId: u.id, name: b.name || 'Experiment', hypothesis: b.hypothesis || '', variable: b.variable || 'unknown', control: b.control || '', variant: b.variant || '', metric: b.metric || 'conversion_rate', status: b.status || 'planned' } })
  return NextResponse.json({ ok: true, id: exp.id })
}
export async function DELETE(req: NextRequest) {
  const u = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!u) return NextResponse.json({ error: 'No user' }, { status: 500 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  await db.experiment.deleteMany({ where: { id, userId: u.id } })
  return NextResponse.json({ ok: true })
}
