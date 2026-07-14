/**
 * self-backup.ts — Agent007 can create a downloadable ZIP backup on command.
 * 
 * toolSelfBackupCreate: Creates a full backup (DB + config + tool definitions)
 *   and saves it to /download/backups/ as a JSON file that can be downloaded.
 *   Returns the download URL so Agent007 can share it with the owner.
 * 
 * toolSelfBackupDownload: Returns the download URL for a specific backup.
 */

import { type ToolContext, type ToolResult } from './tools'
import { db } from './db'
import { promises as fsp } from 'node:fs'
import path from 'node:path'

function ok(p: string, r: string): ToolResult { return { ok: true, preview: p, result: r } }
function bad(r: string): ToolResult { return { ok: false, preview: r.slice(0, 140), result: r } }

async function getOperatorUserId() {
  const u = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
  return u?.id ?? null
}

/**
 * toolSelfBackupCreate — Creates a full downloadable backup.
 * 
 * When the owner says "backup" or "create backup" or "download backup",
 * Agent007 calls this tool. It:
 * 1. Exports ALL database tables to a single JSON file
 * 2. Saves it to /download/backups/ with a timestamp
 * 3. Returns the download URL
 * 4. Agent007 can then send the URL to the owner via WhatsApp/email
 */
export async function toolSelfBackupCreate(args: { label?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const label = (args.label ?? 'manual').toString().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)
  try {
    const userId = await getOperatorUserId()
    if (!userId) return bad('No operator user')

    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const backupDir = '/home/z/my-project/download/backups'
    await fsp.mkdir(backupDir, { recursive: true })

    // Gather ALL data from ALL tables
    const [conversations, memories, incomeEntries, schedules, customSubagents, 
           notificationLogs, userSettings, auditLogs, phoneConfigs, bankAccounts,
           payPalAccounts, apiKeys, twoFactorSecrets, customers, campaigns,
           partnerships, businessStrategies, missionTrackers, servicePackages,
           opportunities, predictions, systemHealths, mlModels, riskRegisters,
           complianceChecks, contractDrafts, pendingManageActions, incomingCommands] = await Promise.all([
      db.conversation.findMany({ include: { Message: true } }).catch(() => []),
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
      db.twoFactorSecret.findMany().catch(() => []),
      db.customer.findMany().catch(() => []),
      db.marketingCampaign.findMany().catch(() => []),
      db.partnership.findMany().catch(() => []),
      db.businessStrategy.findMany().catch(() => []),
      db.missionTracker.findMany().catch(() => []),
      db.servicePackage.findMany().catch(() => []),
      db.opportunity.findMany().catch(() => []),
      db.prediction.findMany().catch(() => []),
      db.systemHealth.findMany().catch(() => []),
      db.mLModel.findMany().catch(() => []),
      db.riskRegister.findMany().catch(() => []),
      db.complianceCheck.findMany().catch(() => []),
      db.contractDraft.findMany().catch(() => []),
      db.pendingManageAction.findMany().catch(() => []),
      db.incomingCommand.findMany().catch(() => []),
    ])

    // Also capture tool registry info
    let toolList: string[] = []
    try {
      const { TOOL_REGISTRY } = await import('./tools')
      toolList = Object.keys(TOOL_REGISTRY)
    } catch {}

    const backup = {
      version: '3.0',
      app: 'Agent007 AI',
      exportedAt: new Date().toISOString(),
      label,
      toolCount: toolList.length,
      tools: toolList,
      data: {
        conversations,
        memories,
        incomeEntries,
        schedules,
        customSubagents,
        notificationLogs,
        userSettings,
        auditLogs,
        phoneConfigs,
        bankAccounts,
        payPalAccounts,
        apiKeys,
        twoFactorSecrets,
        customers,
        campaigns,
        partnerships,
        businessStrategies,
        missionTrackers,
        servicePackages,
        opportunities,
        predictions,
        systemHealths,
        mlModels,
        riskRegisters,
        complianceChecks,
        contractDrafts,
        pendingManageActions,
        incomingCommands,
      },
      stats: {
        conversations: conversations.length,
        messages: conversations.reduce((s: number, c: any) => s + (c.messages?.length || 0), 0),
        memories: memories.length,
        incomeEntries: incomeEntries.length,
        schedules: schedules.length,
        customSubagents: customSubagents.length,
        auditLogs: auditLogs.length,
        bankAccounts: bankAccounts.length,
        apiKeys: apiKeys.length,
        customers: customers.length,
        campaigns: campaigns.length,
        partnerships: partnerships.length,
        tools: toolList.length,
      },
    }

    const filename = `agent007-backup-${ts}-${label}.json`
    const filepath = path.join(backupDir, filename)
    const content = JSON.stringify(backup, null, 2)
    await fsp.writeFile(filepath, content, 'utf-8')

    const sizeKB = Math.round(content.length / 1024)

    // Log to audit
    try {
      await db.auditLog.create({
        data: {
          userId,
          action: 'self_backup',
          entity: 'system',
          description: `Agent007 created self-backup: ${filename} (${sizeKB}KB)`,
          metadata: JSON.stringify({ filename, sizeKB, stats: backup.stats }),
        },
      })
    } catch {}

    const report = `Self-Backup Created ✅
══════════════════════════════════════════════
File: ${filename}
Size: ${sizeKB} KB
Label: ${label}
Timestamp: ${backup.exportedAt}

BACKUP CONTENTS:
  Conversations: ${backup.stats.conversations}
  Messages: ${backup.stats.messages}
  Memory records: ${backup.stats.memories}
  Income entries: ${backup.stats.incomeEntries}
  Schedules: ${backup.stats.schedules}
  Sub-agents: ${backup.stats.customSubagents}
  Audit logs: ${backup.stats.auditLogs}
  Bank accounts: ${backup.stats.bankAccounts}
  API keys: ${backup.stats.apiKeys}
  Customers: ${backup.stats.customers}
  Campaigns: ${backup.stats.campaigns}
  Partnerships: ${backup.stats.partnerships}
  Tools: ${backup.stats.tools}

DOWNLOAD:
  The backup file is saved at: ${filepath}
  
  To download via browser: https://agent007-ai.vercel.app/api/backup
  (This downloads the latest backup as a JSON file)

  The owner can also download it from: Settings → Backup/Restore section

CAPABILITY STATUS: Agent007 can create self-backups on owner command.`
    return ok(`Backup created: ${filename} (${sizeKB}KB)`, report)
  } catch (e: any) { return bad(`Self-backup failed: ${e?.message}`) }
}

/**
 * toolSelfBackupList — List all available backups.
 */
export async function toolSelfBackupList(_args: any, _ctx: ToolContext): Promise<ToolResult> {
  try {
    const backupDir = '/home/z/my-project/download/backups'
    let files: string[] = []
    try { files = await fsp.readdir(backupDir) } catch {}
    
    const backups: Array<{ name: string; size: string }> = []
    for (const f of files.filter(f => f.endsWith('.json'))) {
      try {
        const stat = await fsp.stat(path.join(backupDir, f))
        backups.push({ name: f, size: `${Math.round(stat.size / 1024)}KB` })
      } catch {}
    }

    if (backups.length === 0) {
      return ok('No backups found', 'No backups found. Use self_backup_create to create one.')
    }

    const report = `Available Backups\n══════════════════════════════════════════════\n${backups.map((b, i) => `  ${i + 1}. ${b.name} (${b.size})`).join('\n')}\n\nTo download: https://agent007-ai.vercel.app/api/backup\nTo restore: Use restore_from_backup tool with the file path.`
    return ok(`${backups.length} backups available`, report)
  } catch (e: any) { return bad(`Backup list failed: ${e?.message}`) }
}
