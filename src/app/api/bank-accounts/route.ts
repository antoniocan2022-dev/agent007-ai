import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { getSessionUserId } from '@/lib/session-user'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await ensureDbReady().catch(() => {})
    const userId = await getSessionUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const accounts = await db.bankAccount.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } })
    return NextResponse.json({ accounts })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}

export async function POST(req: NextRequest) {
  try {
    await ensureDbReady().catch(() => {})
    const userId = await getSessionUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await req.json()
    const { accountHolder, bankName, accountType, accountNumber, routingNumber, label } = body
    if (!accountHolder || !bankName || !accountNumber || !routingNumber) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    const OBF_SALT = 'agent007-obf-salt-2024'
    const obfAcctNum = Buffer.from(accountNumber + OBF_SALT).toString('base64')
    const obfRouting = Buffer.from(routingNumber + OBF_SALT).toString('base64')
    const accountLast4 = accountNumber.slice(-4)
    const account = await db.bankAccount.create({ data: { userId, accountHolder, bankName, accountType: accountType || 'checking', accountNumber: obfAcctNum, routingNumber: obfRouting, accountLast4, label: label || `${bankName} ${accountType || 'checking'}` } })
    return NextResponse.json({ ok: true, account: { id: account.id, label: account.label, accountLast4: account.accountLast4 } })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
