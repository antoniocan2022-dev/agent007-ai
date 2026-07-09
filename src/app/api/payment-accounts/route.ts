import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUserId } from '@/lib/session-user'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OBF_SALT = 'agent007-payment-account-obf-salt-v1'
function obf(t: string): string { let r=''; for(let i=0;i<t.length;i++) r+=String.fromCharCode(t.charCodeAt(i)^OBF_SALT.charCodeAt(i%OBF_SALT.length)); return Buffer.from(r,'binary').toString('base64') }
function deobf(t: string): string { try { const d=Buffer.from(t,'base64').toString('binary'); let r=''; for(let i=0;i<d.length;i++) r+=String.fromCharCode(d.charCodeAt(i)^OBF_SALT.charCodeAt(i%OBF_SALT.length)); return r } catch { return '' } }

export async function GET() {
  try {
    const userId = await getSessionUserId()
    if (!userId) return NextResponse.json({ accounts: [], count: 0 })
    const rows = await db.platformConnection.findMany({ where: { userId, platform: { in: ['paypal', 'bank'] } }, orderBy: { createdAt: 'desc' } })
    return NextResponse.json({ accounts: rows.map(r => { const m = r.metadata ? JSON.parse(r.metadata) : {}; return { id: r.id, platform: r.platform, accountName: r.accountName, connected: r.connected, email: m.email, bankName: m.bankName, bankAccountLast4: m.bankAccountLast4, bankAccountType: m.bankAccountType, verificationStatus: m.verificationStatus ?? 'pending', lastSync: r.lastSync?.toISOString() ?? null } }), count: rows.length })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getSessionUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await req.json()
    const type = (body.type ?? '').toString().toLowerCase()
    if (type === 'paypal') {
      const email = (body.email ?? '').toString().trim().toLowerCase()
      if (!email) return NextResponse.json({ error: 'PayPal email required' }, { status: 400 })
      const metadata: any = { email, verificationStatus: body.clientId ? 'verified' : 'pending' }
      if (body.webhookId) metadata.webhookId = body.webhookId
      const created = await db.platformConnection.create({ data: { userId, platform: 'paypal', accountName: email, apiKey: body.clientId ? obf(body.clientId) : null, apiSecret: body.clientSecret ? obf(body.clientSecret) : null, connected: true, metadata: JSON.stringify(metadata), lastSync: new Date() } })
      return NextResponse.json({ ok: true, message: `PayPal "${email}" linked.`, account: { id: created.id, email } })
    }
    if (type === 'bank') {
      const ah = (body.accountHolder ?? '').toString().trim(), bn = (body.bankName ?? '').toString().trim(), an = (body.accountNumber ?? '').toString().replace(/\s/g,''), rn = (body.routingNumber ?? '').toString().replace(/\s/g,'')
      if (!ah || !bn || !an || !rn) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
      if (rn.length !== 9) return NextResponse.json({ error: 'Routing must be 9 digits' }, { status: 400 })
      const last4 = an.slice(-4), metadata: any = { bankName: bn, bankAccountType: body.accountType ?? 'checking', bankAccountLast4: last4, bankRoutingLast4: rn.slice(-4), bankAccountHolder: ah, bankCountry: body.country ?? 'US', bankCurrency: body.currency ?? 'USD', verificationStatus: 'pending', microDeposit1: 'sent', microDeposit2: 'sent' }
      const created = await db.platformConnection.create({ data: { userId, platform: 'bank', accountName: `${bn} ••••${last4}`, apiKey: obf(an), apiSecret: obf(rn), connected: false, metadata: JSON.stringify(metadata) } })
      return NextResponse.json({ ok: true, message: `Bank "${bn} ••••${last4}" added.`, account: { id: created.id, bankName: bn, last4 } })
    }
    return NextResponse.json({ error: 'Type must be "paypal" or "bank"' }, { status: 400 })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}

export async function DELETE(req: NextRequest) {
  try {
    const userId = await getSessionUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    await db.platformConnection.deleteMany({ where: { id, userId } })
    return NextResponse.json({ ok: true, message: 'Account unlinked.' })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}

export { deobf }
