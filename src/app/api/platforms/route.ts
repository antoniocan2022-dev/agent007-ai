import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const OBF = 'agent007-api-key-obfuscation-salt-v2'
function obf(t: string) { let r=''; for(let i=0;i<t.length;i++) r+=String.fromCharCode(t.charCodeAt(i)^OBF.charCodeAt(i%OBF.length)); return Buffer.from(r,'binary').toString('base64') }
export async function GET() {
  const u = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!u) return NextResponse.json({ platforms: [] })
  const plats = await db.platformConnection.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' } })
  const masked = plats.map(p => ({ ...p, apiKey: p.apiKey ? '****' : null, apiSecret: p.apiSecret ? '****' : null, accessToken: p.accessToken ? '****' : null }))
  return NextResponse.json({ platforms: masked })
}
export async function POST(req: NextRequest) {
  const u = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!u) return NextResponse.json({ error: 'No user' }, { status: 500 })
  const b = await req.json().catch(() => ({}))
  const plat = await db.platformConnection.create({ data: { userId: u.id, platform: b.platform, accountName: b.accountName || '', apiKey: b.apiKey ? obf(b.apiKey) : null, apiSecret: b.apiSecret ? obf(b.apiSecret) : null, accessToken: b.accessToken ? obf(b.accessToken) : null, connected: !!b.apiKey || !!b.accessToken, metadata: b.metadata || null } })
  return NextResponse.json({ ok: true, id: plat.id })
}
export async function DELETE(req: NextRequest) {
  const u = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!u) return NextResponse.json({ error: 'No user' }, { status: 500 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  await db.platformConnection.deleteMany({ where: { id, userId: u.id } })
  return NextResponse.json({ ok: true })
}
