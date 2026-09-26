import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { simpleCrudModelFor } from '@/lib/simple-crud-model-registry'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET() {
  const u = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!u) return NextResponse.json({ items: [] })
  const items = await db[simpleCrudModelFor('system-health')].findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' }, take: 50 })
  return NextResponse.json({ items })
}
export async function POST(req: NextRequest) {
  const u = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!u) return NextResponse.json({ error: 'No user' }, { status: 500 })
  const b = await req.json().catch(() => ({}))
  const item = await db[simpleCrudModelFor('system-health')].create({ data: { userId: u.id, ...b } })
  return NextResponse.json({ ok: true, id: item.id })
}
export async function DELETE(req: NextRequest) {
  const u = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!u) return NextResponse.json({ error: 'No user' }, { status: 500 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  await db[simpleCrudModelFor('system-health')].deleteMany({ where: { id, userId: u.id } })
  return NextResponse.json({ ok: true })
}
