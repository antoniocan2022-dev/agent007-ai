import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { promises as fsp } from 'node:fs'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/backup — downloads a full backup as JSON file */
export async function GET() {
  await ensureDbReady().catch(() => {})
  try {
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
      stats: {
        conversations: conversations.length,
        memories: memories.length,
        schedules: schedules.length,
        subAgents: customSubagents.length,
        auditLogs: auditLogs.length,
      },
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
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const data = body?.backup?.data || body?.data
  if (!data) return NextResponse.json({ error: 'Missing "data" field' }, { status: 400 })
  
  const stats = { memories: 0, schedules: 0, customSubagents: 0, errors: [] as string[] }
  try {
    if (Array.isArray(data.memories)) {
      for (const m of data.memories) {
        try { await db.memory.upsert({ where: { key: m.key }, create: { key: m.key, value: m.value, category: m.category || 'general' }, update: { value: m.value, category: m.category || 'general' } }); stats.memories++ } catch {}
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
