import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET() {
  const u = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!u) return NextResponse.json({ items: [] })
  // Dynamic model lookup based on directory name
  const modelName = 'sentiment'.replace(/-/g, '')
  // @ts-ignore — dynamic model access
  const items = await (db as any)[modelName === 'systemhealth' ? 'systemHealth' : modelName === 'mlmodels' ? 'mLModel' : modelName === 'compliancecheck' ? 'complianceCheck' : modelName === 'sentimentlog' ? 'sentimentLog' : modelName === 'contractdraft' ? 'contractDraft' : 'prediction'].findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' }, take: 50 })
  return NextResponse.json({ items })
}
export async function POST(req: NextRequest) {
  const u = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!u) return NextResponse.json({ error: 'No user' }, { status: 500 })
  const b = await req.json().catch(() => ({}))
  const modelName = 'sentiment'.replace(/-/g, '')
  // @ts-ignore
  const item = await (db as any)[modelName === 'systemhealth' ? 'systemHealth' : modelName === 'mlmodels' ? 'mLModel' : modelName === 'compliancecheck' ? 'complianceCheck' : modelName === 'sentimentlog' ? 'sentimentLog' : modelName === 'contractdraft' ? 'contractDraft' : 'prediction'].create({ data: { userId: u.id, ...b } })
  return NextResponse.json({ ok: true, id: item.id })
}
export async function DELETE(req: NextRequest) {
  const u = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!u) return NextResponse.json({ error: 'No user' }, { status: 500 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const modelName = 'sentiment'.replace(/-/g, '')
  // @ts-ignore
  await (db as any)[modelName === 'systemhealth' ? 'systemHealth' : modelName === 'mlmodels' ? 'mLModel' : modelName === 'compliancecheck' ? 'complianceCheck' : modelName === 'sentimentlog' ? 'sentimentLog' : modelName === 'contractdraft' ? 'contractDraft' : 'prediction'].deleteMany({ where: { id, userId: u.id } })
  return NextResponse.json({ ok: true })
}
