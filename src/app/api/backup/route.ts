import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { promises as fsp } from 'node:fs'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VAULT_DIR = '/home/z/my-project/download/vault'
const OWNER_KEY = 'agent007-owner-vault-key-2024-antonio'

function decrypt(b64: string): string {
  const buf = Buffer.from(b64, 'base64')
  const keyBuf = Buffer.from(OWNER_KEY, 'utf-8')
  const result = Buffer.alloc(buf.length)
  for (let i = 0; i < buf.length; i++) {
    result[i] = buf[i] ^ keyBuf[i % keyBuf.length]
  }
  return result.toString('utf-8')
}

/** GET /api/backup — downloads full backup OR vault file */
export async function GET(req: NextRequest) {
  await ensureDbReady().catch(() => {})
    await new Promise(r => setTimeout(r, 500)) // Give tables time to create
  try {
    const url = new URL(req.url)
    const vaultFile = url.searchParams.get('vault')
    
    // Vault file download mode
    if (vaultFile) {
      const safeFile = path.basename(vaultFile)
      const filepath = path.join(VAULT_DIR, safeFile)
      try {
        await fsp.access(filepath)
      } catch {
        return NextResponse.json({ error: 'Vault file not found: ' + safeFile }, { status: 404 })
      }
      const content = await fsp.readFile(filepath, 'utf-8')
      const data = JSON.parse(content)
      const decrypted = decrypt(data._encrypted || '')
      return new NextResponse(decrypted, {
        headers: {
          'Content-Type': 'text/plain',
          'Content-Disposition': `attachment; filename="${safeFile.replace('.enc', '.txt')}"`,
        },
      })
    }

    // Vault list mode
    if (url.searchParams.get('list_vault') === '1') {
      await fsp.mkdir(VAULT_DIR, { recursive: true })
      const files = (await fsp.readdir(VAULT_DIR)).filter(f => f.endsWith('.enc'))
      return NextResponse.json({ vaultFiles: files })
    }

    // Full backup mode (default)
    const [conversations, memories, incomeEntries, schedules, customSubagents, 
           notificationLogs, userSettings, auditLogs, phoneConfigs, bankAccounts,
           payPalAccounts, apiKeys, customers, campaigns, partnerships] = await Promise.all([
      db.conversation.findMany({ include: { messages: true } }).catch(() => []),
      db.memory.findMany().catch(() => []),
      db.incomeEntry.findMany().catch(() => []),
      db.schedule.findMany().catch(() => []),
      db.customSubagent.findMany().catch(() => []),
      db.notificationLog.findMany().catch(() => []),
      db.userSetting.findMany().catch(() => []),
      db.auditLog.findMany().catch(() => []),
      db.phoneConfig.findMany().catch(() => []),
      db.bankAccount.findMany().catch(() => []),
      db.payPalAccount.findMany().catch(() => []),
      db.apiKey.findMany().catch(() => []),
      db.customer.findMany().catch(() => []),
      db.marketingCampaign.findMany().catch(() => []),
      db.partnership.findMany().catch(() => []),
    ])

    const backup = {
      version: '3.0',
      app: 'Agent007 AI',
      exportedAt: new Date().toISOString(),
      data: { conversations, memories, incomeEntries, schedules, customSubagents, notificationLogs, userSettings, auditLogs, phoneConfigs, bankAccounts, payPalAccounts, apiKeys, customers, campaigns, partnerships },
    }

    const filename = `agent007-backup-${new Date().toISOString().slice(0, 10)}.json`
    return new NextResponse(JSON.stringify(backup, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 })
  }
}

/** POST /api/backup — restore from backup */
export async function POST(req: NextRequest) {
  await ensureDbReady().catch(() => {})
    await new Promise(r => setTimeout(r, 500)) // Give tables time to create
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const data = body?.backup?.data || body?.data
  if (!data) return NextResponse.json({ error: 'Missing "data" field' }, { status: 400 })
  
  const stats = { memories: 0, schedules: 0, customSubagents: 0 }
  try {
    if (Array.isArray(data.memories)) {
      for (const m of data.memories) {
        try { await db.memory.upsert({ where: { key: m.key }, create: { key: m.key, value: m.value, category: m.category || 'general' }, update: { value: m.value } }); stats.memories++ } catch {}
      }
    }
    if (Array.isArray(data.customSubagents)) {
      for (const s of data.customSubagents) {
        try { await db.customSubagent.upsert({ where: { id: s.id }, create: s, update: s }); stats.customSubagents++ } catch {}
      }
    }
    return NextResponse.json({ ok: true, stats })
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }) }
}
