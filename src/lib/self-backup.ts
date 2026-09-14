/**
 * self-backup.ts — Agent007 can create a downloadable ZIP backup on command.
 *
 * toolSelfBackupCreate / toolSelfBackupList delegate to backup-functions.ts's
 * createBackup()/listBackups() -- the canonical backup implementation (also used by
 * /api/system/zip-backup and the orchestrator's create_backup/list_backups manage
 * actions). This file used to maintain its own independent Promise.all of ~27 tables
 * and dump every column (including ApiKey.key, BankAccount numbers, PayPalAccount
 * secrets, TwoFactorSecret.secret) in plaintext -- a second, drifted, unencrypted
 * backup path alongside the canonical one. Delegating keeps exactly one place that
 * decides which tables get backed up and how secrets are handled.
 */

import { type ToolContext, type ToolResult } from './tools'
import { createBackup, listBackups } from './backup-functions'

function ok(p: string, r: string): ToolResult { return { ok: true, preview: p, result: r } }
function bad(r: string): ToolResult { return { ok: false, preview: r.slice(0, 140), result: r } }

/**
 * toolSelfBackupCreate — Creates a full downloadable backup via the canonical
 * createBackup() implementation and reports the result.
 */
export async function toolSelfBackupCreate(args: { label?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const label = (args.label ?? 'manual').toString()
  const result = await createBackup(label)
  if (!result.ok) return bad(`Self-backup failed: ${result.error ?? 'unknown error'}`)

  const report = `Self-Backup Created ✅
══════════════════════════════════════════════
File: ${result.zipFilename}
Size: ${result.zipSizeMB} MB
Label: ${result.label}
Timestamp: ${result.timestamp}

BACKUP CONTENTS:
  Database tables: ${result.contents.databaseTables}
  Total rows: ${result.contents.totalRows}
  Source files: ${result.contents.sourceFiles}
  Permanent upgrades: ${result.contents.upgrades}

DOWNLOAD:
  ${result.downloadUrl}

  To download via browser (while signed in): https://agent007-ai.vercel.app/api/system/backup-download
  The owner can also download it from: Settings → Backup/Restore section

CAPABILITY STATUS: Agent007 can create self-backups on owner command.`
  return ok(`Backup created: ${result.zipFilename} (${result.zipSizeMB}MB)`, report)
}

/**
 * toolSelfBackupList — List all available backups via the canonical listBackups().
 */
export async function toolSelfBackupList(_args: any, _ctx: ToolContext): Promise<ToolResult> {
  const result = await listBackups()
  if (!result.ok) return bad(`Backup list failed: ${result.message}`)
  if (result.count === 0) {
    return ok('No backups found', 'No backups found. Use self_backup_create to create one.')
  }

  const report = `Available Backups\n══════════════════════════════════════════════\n${result.backups.map((b, i) => `  ${i + 1}. ${b.name} (${b.size})`).join('\n')}\n\nTo download (while signed in): https://agent007-ai.vercel.app${result.backups[0].path}`
  return ok(`${result.count} backups available`, report)
}
