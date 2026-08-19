/**
 * Direct backup functions used by the legacy /api/system/zip-backup route.
 *
 * This implementation is intentionally host-neutral: backup staging uses
 * configurable directories with a safe OS temp fallback, and provider identity
 * is exposed only through the neutral runtime adapter.
 */
import { promises as fsp, readFileSync, createReadStream, createWriteStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import { db, ensureDbReady } from './db'
import { getCapabilities } from './system-functions'
import { getAllUpgrades } from './upgrade-manifest'
import { getPublicBaseUrl } from './runtime/public-base-url'
import { isVercelRuntime } from './runtime/host-runtime'
import { BACKUP_TABLES } from './backup-v2'

const BACKUP_DIR = process.env.AGENT007_BACKUP_DIR?.trim() || path.join(os.tmpdir(), 'agent007-backups')
const DOWNLOAD_DIR = process.env.AGENT007_DOWNLOAD_DIR?.trim() || path.join(os.tmpdir(), 'agent007-downloads')

export interface BackupResult {
  ok: boolean
  label: string
  jsonFilename: string
  jsonSizeMB: string
  zipFilename: string
  zipSizeMB: string
  downloadUrl: string
  absolutePath: string
  contents: {
    databaseTables: number
    totalRows: number
    sourceFiles: number
    upgrades: number
    capabilities: any
  }
  message: string
  timestamp: string
  error?: string
  warning?: string
}

export interface BackupListEntry {
  name: string
  size: string
  sizeBytes: number
  created: string
  path: string
}

export interface BackupListResult {
  ok: boolean
  backups: BackupListEntry[]
  count: number
  downloadBaseUrl: string
  message: string
  warning?: string
}

// Keep proof-ledger tables explicitly included here while the canonical Backup
// V2 registry is reconciled by the controlled release path.
const TABLE_NAMES = Array.from(new Set([
  ...BACKUP_TABLES.map((name) => name.charAt(0).toLowerCase() + name.slice(1)),
  'executionReceipt', 'evidenceLedger', 'evidenceSource', 'evidenceClaim',
]))

const SOURCE_PATHS = [
  'src/lib/agent.ts', 'src/lib/orchestrator.ts', 'src/lib/tools.ts',
  'src/lib/subagents.ts', 'src/lib/owner-auth.ts', 'src/lib/settings.ts',
  'src/lib/upgrade-manifest.ts', 'src/lib/self-backup.ts', 'src/lib/email.ts',
  'src/lib/whatsapp-bridge.ts', 'src/lib/db.ts', 'src/lib/auth.ts',
  'src/lib/tool-protection.ts', 'src/lib/manage-actions.ts', 'src/lib/system-functions.ts',
  'src/lib/proof-ledger.ts', 'src/app/login/page.tsx', 'src/app/page.tsx',
  'src/components/agent/tabs/dashboard-tab.tsx',
  'src/components/agent/tabs/settings-tab.tsx',
  'prisma/schema.prisma', 'package.json', 'next.config.ts', 'tsconfig.json', 'tailwind.config.ts',
] as const

export async function createBackup(label = 'full-system'): Promise<BackupResult> {
  try {
    try {
      await ensureDbReady()
    } catch (error) {
      console.warn('[backup] ensureDbReady failed; continuing with degraded backup:', error instanceof Error ? error.message : String(error))
    }

    const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)
    const userId = await db.user.findFirst({ orderBy: { createdAt: 'asc' } }).then((user) => user?.id ?? null).catch(() => null)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    await fsp.mkdir(BACKUP_DIR, { recursive: true })

    const database: Record<string, unknown[]> = {}
    const counts: Record<string, number> = {}
    for (const table of TABLE_NAMES) {
      try {
        const rows = await (db as any)[table].findMany()
        database[table] = rows
        counts[table] = rows.length
      } catch {
        database[table] = []
        counts[table] = -1
      }
    }

    const upgrades = getAllUpgrades()
    let capabilities: any = null
    try {
      capabilities = (await getCapabilities()).summary
    } catch (error) {
      console.warn('[backup] getCapabilities failed:', error instanceof Error ? error.message : String(error))
    }

    const sourceFiles: Record<string, string> = {}
    for (const relativePath of SOURCE_PATHS) {
      try {
        sourceFiles[relativePath] = readFileSync(path.join(process.cwd(), relativePath), 'utf8')
      } catch {
        // Source files may be absent from some runtime bundles; the backup remains valid.
      }
    }

    const backup = {
      version: '5.2',
      app: 'Agent007 AI',
      exportedAt: new Date().toISOString(),
      label: safeLabel,
      mission: { monthlyIncomeTarget: 20000, monthlyGrowthRate: 20, dailyGrowthTarget: 20 },
      capabilities,
      upgrades: { total: upgrades.length, integrityOk: true, list: upgrades },
      database: {
        exportedAt: new Date().toISOString(),
        tableCount: TABLE_NAMES.length,
        counts,
        totalRows: Object.values(counts).reduce((sum, count) => sum + (count > 0 ? count : 0), 0),
        data: database,
      },
      sourceCode: { fileCount: Object.keys(sourceFiles).length, files: sourceFiles },
      config: {
        nodeVersion: process.version,
        platform: process.platform,
        runtimeProvider: isVercelRuntime() ? 'vercel' : 'generic',
        publicUrlConfigured: (() => { try { return Boolean(getPublicBaseUrl()) } catch { return false } })(),
        nextAuthConfigured: Boolean(process.env.NEXTAUTH_SECRET),
        smtpConfigured: Boolean(process.env.SMTP_HOST && process.env.SMTP_PORT),
        openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
        backupDir: BACKUP_DIR,
        downloadDir: DOWNLOAD_DIR,
      },
    }

    const jsonFilename = `agent007-backup-${timestamp}-${safeLabel}.json`
    const jsonPath = path.join(BACKUP_DIR, jsonFilename)
    const jsonContent = JSON.stringify(backup, null, 2)
    await fsp.writeFile(jsonPath, jsonContent, 'utf8')
    const jsonSizeMB = (jsonContent.length / 1024 / 1024).toFixed(2)

    let archiveFilename = jsonFilename
    let archiveSizeMB = jsonSizeMB
    let warning: string | undefined
    try {
      const gzipFilename = `agent007-backup-${timestamp}-${safeLabel}.json.gz`
      const gzipPath = path.join(BACKUP_DIR, gzipFilename)
      await pipeline(createReadStream(jsonPath), createGzip(), createWriteStream(gzipPath))
      archiveFilename = gzipFilename
      archiveSizeMB = ((await stat(gzipPath)).size / 1024 / 1024).toFixed(2)
    } catch (error) {
      warning = `Compression failed; JSON backup remains available: ${error instanceof Error ? error.message : String(error)}`
    }

    try {
      await db.auditLog.create({
        data: {
          userId: userId ?? 'system',
          action: 'zip_backup_created',
          entity: 'system',
          description: `Backup created: ${archiveFilename} (${archiveSizeMB}MB) — ${TABLE_NAMES.length} tables`,
        },
      })
    } catch {
      // Backup creation does not depend on audit-log availability.
    }

    return {
      ok: true,
      label: safeLabel,
      jsonFilename,
      jsonSizeMB,
      zipFilename: archiveFilename,
      zipSizeMB: archiveSizeMB,
      downloadUrl: `/api/system/zip-backup?download=${encodeURIComponent(archiveFilename)}`,
      absolutePath: path.join(BACKUP_DIR, archiveFilename),
      contents: {
        databaseTables: TABLE_NAMES.length,
        totalRows: backup.database.totalRows,
        sourceFiles: Object.keys(sourceFiles).length,
        upgrades: upgrades.length,
        capabilities,
      },
      message: `Backup created: ${archiveFilename} (${archiveSizeMB}MB)`,
      timestamp: new Date().toISOString(),
      warning,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      label,
      jsonFilename: '',
      jsonSizeMB: '0',
      zipFilename: '',
      zipSizeMB: '0',
      downloadUrl: '',
      absolutePath: '',
      contents: { databaseTables: 0, totalRows: 0, sourceFiles: 0, upgrades: 0, capabilities: null },
      message: `Backup failed: ${message}`,
      timestamp: new Date().toISOString(),
      error: message,
    }
  }
}

export async function listBackups(): Promise<BackupListResult> {
  try {
    const backups: BackupListEntry[] = []
    const seen = new Set<string>()
    for (const dir of [BACKUP_DIR, DOWNLOAD_DIR]) {
      await fsp.mkdir(dir, { recursive: true })
      const files = await fsp.readdir(dir)
      for (const file of files) {
        if (!/\.(zip|json|gz)$/.test(file) || seen.has(file)) continue
        seen.add(file)
        try {
          const filePath = path.join(dir, file)
          const fileStat = await stat(filePath)
          if (!fileStat.isFile()) continue
          backups.push({
            name: file,
            size: `${(fileStat.size / 1024 / 1024).toFixed(2)} MB`,
            sizeBytes: fileStat.size,
            created: fileStat.mtime.toISOString(),
            path: `/api/system/zip-backup?download=${encodeURIComponent(file)}`,
          })
        } catch {
          // Ignore individual unreadable entries.
        }
      }
    }

    backups.sort((a, b) => b.created.localeCompare(a.created))
    return {
      ok: true,
      backups,
      count: backups.length,
      downloadBaseUrl: '/api/system/zip-backup?download=',
      message: `${backups.length} backup(s) available`,
      warning: backups.length === 0 ? 'Backup storage is empty; generate and download a backup before relying on it for recovery.' : undefined,
    }
  } catch (error) {
    return {
      ok: false,
      backups: [],
      count: 0,
      downloadBaseUrl: '/api/system/zip-backup?download=',
      message: `List failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export async function findBackupFile(filename: string): Promise<string | null> {
  const safeFile = path.basename(filename)
  for (const dir of [BACKUP_DIR, DOWNLOAD_DIR]) {
    const candidate = path.join(dir, safeFile)
    try {
      if ((await stat(candidate)).isFile()) return candidate
    } catch {
      // Continue to next directory.
    }
  }
  return null
}

export function getBackupDir(): string {
  return BACKUP_DIR
}

export function getDownloadDir(): string {
  return DOWNLOAD_DIR
}

/** Compatibility helper; provider identity is isolated in the host adapter. */
export function isVercel(): boolean {
  return isVercelRuntime()
}
