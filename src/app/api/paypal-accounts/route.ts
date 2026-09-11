import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { getSessionUserId } from '@/lib/session-user'
import { encryptCredential } from '@/lib/credential-encryption'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await ensureDbReady().catch(() => {})
    const userId = await getSessionUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const accounts = await db.payPalAccount.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } })
    return NextResponse.json({ accounts })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}

export async function POST(req: NextRequest) {
  try {
    await ensureDbReady().catch(() => {})
    const userId = await getSessionUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await req.json()
    const { email, clientId, clientSecret } = body
    if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })
    // Real AES-256-GCM encryption (credential-encryption.ts), not the base64-plus-hardcoded-public-salt
    // "obfuscation" this route used to apply -- that scheme offered no real confidentiality, since the
    // salt is public source code, not a secret. Requires CREDENTIAL_ENCRYPTION_KEY or
    // BACKUP_ENCRYPTION_KEY to be configured; refuses to store a real secret in the clear otherwise.
    let encryptedClientId: string | null = null
    let encryptedClientSecret: string | null = null
    try {
      if (clientId) encryptedClientId = encryptCredential(clientId)
      if (clientSecret) encryptedClientSecret = encryptCredential(clientSecret)
    } catch {
      return NextResponse.json({ error: 'Credential encryption is not configured on this deployment. Set CREDENTIAL_ENCRYPTION_KEY (or BACKUP_ENCRYPTION_KEY).' }, { status: 503 })
    }
    const account = await db.payPalAccount.create({ data: { userId, email, clientId: encryptedClientId, clientSecret: encryptedClientSecret } })
    return NextResponse.json({ ok: true, account: { id: account.id, email: account.email } })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
