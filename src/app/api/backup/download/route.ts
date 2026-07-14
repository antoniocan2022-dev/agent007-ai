import { NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { promises as fsp } from 'node:fs'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/backup/download — creates + downloads a full backup as JSON */
export async function GET() {
  await ensureDbReady().catch(() => {})
  try {
    const [conversations, memories, incomeEntries, schedules, customSubagents, 
           auditLogs, phoneConfigs, apiKeys, customers, campaigns, partnerships] = await Promise.all([
      db.conversation.findMany({ include: { Message: true } }).catch(() => []),
      db.memory.findMany().catch(() => []),
      db.incomeEntry.findMany().catch(() => []),
      db.schedule.findMany().catch(() => []),
      db.customSubagent.findMany().catch(() => []),
      db.auditLog.findMany({ take: 100, orderBy: { createdAt: 'desc' } }).catch(() => []),
      db.phoneConfig.findMany().catch(() => []),
      db.apiKey.findMany().catch(() => []),
      db.customer.findMany().catch(() => []),
      db.marketingCampaign.findMany().catch(() => []),
      db.partnership.findMany().catch(() => []),
    ])

    let toolList: string[] = []
    try {
      const { TOOL_REGISTRY } = await import('@/lib/tools')
      toolList = Object.keys(TOOL_REGISTRY)
    } catch {}

    const backup = {
      version: '3.0',
      app: 'Agent007 AI',
      exportedAt: new Date().toISOString(),
      mission: '$20,000/month passive income with 20% monthly growth',
      toolCount: toolList.length,
      tools: toolList,
      data: { conversations, memories, incomeEntries, schedules, customSubagents, auditLogs, phoneConfigs, apiKeys, customers, campaigns, partnerships },
    }

    // Also save to disk
    const backupDir = '/home/z/my-project/download/backups'
    try { await fsp.mkdir(backupDir, { recursive: true }) } catch {}
    const filename = `agent007-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    try { await fsp.writeFile(path.join(backupDir, filename), JSON.stringify(backup, null, 2), 'utf-8') } catch {}

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
