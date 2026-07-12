/**
 * backup-functions.ts — Direct backup functions (no HTTP self-fetch).
 *
 * PROBLEM ON VERCEL
 * =================
 * The orchestrator's create_backup / list_backups / load_backup actions
 * used `internalFetch()` to call /api/system/zip-backup. On Vercel,
 * serverless functions can't reliably fetch from themselves — the
 * response is HTML (login page / error page), not JSON, so the parser
 * throws "non-JSON response". This is the classic Vercel self-fetch
 * problem.
 *
 * SOLUTION
 * ========
 * Move the actual backup logic into this module as plain async functions.
 * Both the orchestrator AND the /api/system/zip-backup route call these
 * functions directly. No HTTP roundtrip = no HTML response = no parser
 * error.
 *
 * VERCEL-AWARE PATHS
 * ==================
 * - On Vercel: write to /tmp/agent007-backups (the only writable dir)
 * - On local dev: write to /home/z/my-project/download/backups
 * - Source files: skip on Vercel (not bundled); include on local dev
 *
 * NO `zip` BINARY DEPENDENCY
 * ==========================
 * Vercel doesn't have the `zip` command. We use Node's built-in `zlib`
 * to create a .gz file instead, OR we return the JSON as-is if both fail.
 */

import { db, ensureDbReady } from './db'
import { getCapabilities } from './system-functions'
import { getAllUpgrades } from './upgrade-manifest'
import { promises as fsp, readFileSync, createReadStream, createWriteStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'

const IS_VERCEL = !!process.env.VERCEL
const BACKUP_DIR = IS_VERCEL
  ? path.join(os.tmpdir(), 'agent007-backups')
  : '/home/z/my-project/download/backups'
const DOWNLOAD_DIR = IS_VERCEL
  ? path.join(os.tmpdir(), 'agent007-downloads')
  : '/home/z/my-project/download'

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

/**
 * Create a backup. This is the CANONICAL implementation — both the
 * orchestrator's create_backup manage action and the POST
 * /api/system/zip-backup route call this function directly.
 *
 * @param label - short label for the backup filename (default: 'full-system')
 */
export async function createBackup(label: string = 'full-system'): Promise<BackupResult> {
  try {
    // UPGRADE #58 — Don't fail the whole backup if DB init fails.
    // The owner needs to be able to download a backup even when the DB
    // is in a degraded state. We'll skip DB tables that fail and include
    // everything else (manifest, capabilities, source files, etc.).
    try {
      await ensureDbReady()
    } catch (dbInitErr: any) {
      console.warn('[backup] ensureDbReady failed (continuing with degraded backup):', dbInitErr?.message)
    }
    const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)
    // UPGRADE #58 — userId may be null on cold starts with ephemeral DB.
    // Don't abort the backup — proceed with userId=null and skip user-
    // specific data. We can still include manifest, capabilities, source
    // files, and config metadata.
    let userId: string | null = null
    try {
      userId = (await db.user.findFirst({ orderBy: { createdAt: 'asc' } }))?.id ?? null
    } catch (userErr: any) {
      console.warn('[backup] db.user.findFirst failed (continuing):', userErr?.message)
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    await fsp.mkdir(BACKUP_DIR, { recursive: true })

    // ── Export all 33 DB tables ──────────────────────────────────────────
    const dbExport: Record<string, any> = {}
    const tableNames = [
      'conversation','message','memory','user','userSetting','incomeEntry',
      'transaction','knowledgeDoc','knowledgeChunk','schedule','notificationLog',
      'pendingManageAction','customSubagent','auditLog','twoFactorSecret',
      'phoneConfig','incomingCommand','bankAccount','payPalAccount','apiKey',
      'customer','marketingCampaign','partnership','businessStrategy',
      'missionTracker','servicePackage','opportunity','prediction',
      'systemHealth','mLModel','riskRegister','complianceCheck','contractDraft',
    ]
    const tableCounts: Record<string, number> = {}
    for (const table of tableNames) {
      try {
        const rows = await (db as any)[table].findMany()
        dbExport[table] = rows
        tableCounts[table] = rows.length
      } catch {
        dbExport[table] = []
        tableCounts[table] = -1
      }
    }

    // ── Upgrades (direct function call — no fetch) ──────────────────────
    const upgrades = getAllUpgrades()

    // ── Capabilities (direct function call — no fetch) ───────────────────
    let capabilities: any = null
    try {
      const capsResult = await getCapabilities()
      capabilities = capsResult.summary
    } catch (e: any) {
      console.warn('[backup] getCapabilities failed:', e?.message)
    }

    // ── Source files (local dev only — Vercel doesn't bundle them) ──────
    const sourceFiles: Record<string, string> = {}
    if (!IS_VERCEL) {
      const keyPaths = [
        'src/lib/agent.ts','src/lib/orchestrator.ts','src/lib/tools.ts',
        'src/lib/subagents.ts','src/lib/owner-auth.ts','src/lib/settings.ts',
        'src/lib/upgrade-manifest.ts','src/lib/self-backup.ts','src/lib/email.ts',
        'src/lib/whatsapp-bridge.ts','src/lib/db.ts','src/lib/auth.ts',
        'src/lib/tool-protection.ts','src/lib/manage-actions.ts',
        'src/lib/system-functions.ts',
        'src/app/login/page.tsx','src/app/page.tsx',
        'src/components/agent/tabs/dashboard-tab.tsx',
        'src/components/agent/tabs/settings-tab.tsx',
        'prisma/schema.prisma','package.json','next.config.ts','tsconfig.json',
        'tailwind.config.ts',
      ]
      for (const relPath of keyPaths) {
        try {
          const fullPath = path.join(process.cwd(), relPath)
          sourceFiles[relPath] = readFileSync(fullPath, 'utf-8')
        } catch {}
      }
    }

    // ── Build the backup object ──────────────────────────────────────────
    const backup = {
      version: '5.0',
      app: 'Agent007 AI',
      exportedAt: new Date().toISOString(),
      label: safeLabel,
      mission: {
        monthlyIncomeTarget: 20000,
        monthlyGrowthRate: 20,
        dailyGrowthTarget: 20, // FIXED: was 10 — owner confirmed 20% daily
      },
      capabilities: capabilities,
      upgrades: { total: upgrades.length, integrityOk: true, list: upgrades },
      database: {
        exportedAt: new Date().toISOString(),
        tableCount: tableNames.length,
        counts: tableCounts,
        totalRows: Object.values(tableCounts).reduce(
          (s: number, c) => s + (c > 0 ? c : 0),
          0
        ),
        data: dbExport,
      },
      sourceCode: {
        fileCount: Object.keys(sourceFiles).length,
        files: sourceFiles,
        note: IS_VERCEL
          ? 'Source files not bundled on Vercel — use the local dev environment or git to inspect source.'
          : 'Source files included',
      },
      config: {
        nodeVersion: process.version,
        platform: process.platform,
        runtime: IS_VERCEL ? 'vercel-serverless' : 'local-dev',
        nextAuthConfigured: !!process.env.NEXTAUTH_SECRET,
        smtpConfigured: !!(process.env.SMTP_HOST && process.env.SMTP_PORT),
        openaiConfigured: !!process.env.OPENAI_API_KEY,
        vercelUrl: process.env.NEXTAUTH_URL ?? 'not set',
        backupDir: BACKUP_DIR,
      },
    }

    // ── Write JSON ───────────────────────────────────────────────────────
    const jsonFilename = `agent007-backup-${ts}-${safeLabel}.json`
    const jsonFilepath = path.join(BACKUP_DIR, jsonFilename)
    const jsonContent = JSON.stringify(backup, null, 2)
    await fsp.writeFile(jsonFilepath, jsonContent, 'utf-8')
    const jsonSizeMB = (jsonContent.length / 1024 / 1024).toFixed(2)

    // ── Create compressed archive (no `zip` binary — use gzip) ──────────
    let zipFilename: string = jsonFilename
    let zipSizeMB: string = jsonSizeMB
    let compressionWarning: string | undefined

    try {
      const gzipFilename = `agent007-backup-${ts}-${safeLabel}.json.gz`
      const gzipFilepath = path.join(BACKUP_DIR, gzipFilename)
      await pipeline(
        createReadStream(jsonFilepath),
        createGzip(),
        createWriteStream(gzipFilepath)
      )
      const gzStat = await stat(gzipFilepath)
      zipFilename = gzipFilename
      zipSizeMB = (gzStat.size / 1024 / 1024).toFixed(2)
    } catch (e: any) {
      compressionWarning = `Compression failed: ${e?.message}. JSON file still available.`
      // Fallback: just use the JSON file as the "zip"
      zipFilename = jsonFilename
      zipSizeMB = jsonSizeMB
    }

    // ── Audit log ────────────────────────────────────────────────────────
    try {
      await db.auditLog.create({
        data: {
          userId: userId ?? 'system',
          action: 'zip_backup_created',
          entity: 'system',
          description: `Backup created: ${zipFilename} (${zipSizeMB}MB) — ${tableNames.length} tables, ${backup.database.totalRows} rows`,
        },
      })
    } catch {}

    return {
      ok: true,
      label: safeLabel,
      jsonFilename,
      jsonSizeMB,
      zipFilename,
      zipSizeMB,
      downloadUrl: `/api/system/zip-backup?download=${encodeURIComponent(zipFilename)}`,
      absolutePath: path.join(BACKUP_DIR, zipFilename),
      contents: {
        databaseTables: tableNames.length,
        totalRows: backup.database.totalRows,
        sourceFiles: Object.keys(sourceFiles).length,
        upgrades: upgrades.length,
        capabilities,
      },
      message: `Backup created: ${zipFilename} (${zipSizeMB}MB)`,
      timestamp: new Date().toISOString(),
      warning: compressionWarning,
    }
  } catch (e: any) {
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
      message: `Backup failed: ${e?.message ?? String(e)}`,
      timestamp: new Date().toISOString(),
      error: e?.message ?? String(e),
    }
  }
}

/**
 * List all available backups in BACKUP_DIR and DOWNLOAD_DIR.
 * Returns metadata only (no file contents).
 */
export async function listBackups(): Promise<BackupListResult> {
  try {
    await ensureDbReady()
    const backups: BackupListEntry[] = []
    const seenFiles = new Set<string>()
    const searchDirs = [BACKUP_DIR, DOWNLOAD_DIR]

    for (const dir of searchDirs) {
      try {
        await fsp.mkdir(dir, { recursive: true })
        const files = await fsp.readdir(dir)
        for (const f of files) {
          if (!f.endsWith('.zip') && !f.endsWith('.json') && !f.endsWith('.gz')) continue
          if (seenFiles.has(f)) continue
          seenFiles.add(f)
          try {
            const statRes = await stat(path.join(dir, f))
            if (statRes.isFile()) {
              backups.push({
                name: f,
                size: `${(statRes.size / 1024 / 1024).toFixed(2)} MB`,
                sizeBytes: statRes.size,
                created: statRes.mtime.toISOString(),
                path: `/api/system/zip-backup?download=${encodeURIComponent(f)}`,
              })
            }
          } catch {}
        }
      } catch {}
    }

    backups.sort((a, b) => b.created.localeCompare(a.created))

    return {
      ok: true,
      backups,
      count: backups.length,
      downloadBaseUrl: '/api/system/zip-backup?download=',
      message: `${backups.length} backup(s) available`,
      warning: IS_VERCEL && backups.length === 0
        ? 'Vercel uses ephemeral /tmp storage — backups may not persist across cold starts. Download the backup immediately after creation.'
        : undefined,
    }
  } catch (e: any) {
    return {
      ok: false,
      backups: [],
      count: 0,
      downloadBaseUrl: '/api/system/zip-backup?download=',
      message: `List failed: ${e?.message ?? String(e)}`,
    }
  }
}

/**
 * Find a backup file by name. Searches BACKUP_DIR and DOWNLOAD_DIR.
 * Returns the absolute path if found, null otherwise.
 */
export async function findBackupFile(filename: string): Promise<string | null> {
  const safeFile = path.basename(filename)
  const searchDirs = [BACKUP_DIR, DOWNLOAD_DIR]

  for (const dir of searchDirs) {
    const filepath = path.join(dir, safeFile)
    try {
      await fsp.access(filepath)
      const statRes = await stat(filepath)
      if (statRes.isFile()) return filepath
    } catch {}
  }

  // Fuzzy match for "full-backup" / "full-system" labels
  if (safeFile.includes('full-backup') || safeFile.includes('full-system')) {
    for (const dir of searchDirs) {
      try {
        const files = await fsp.readdir(dir)
        const ext = path.extname(safeFile)
        const matching = files
          .filter(f => f.endsWith(ext) && f.includes('backup'))
          .map(f => ({ name: f, path: path.join(dir, f) }))
        const withStats = await Promise.all(
          matching.map(async m => {
            try {
              const s = await stat(m.path)
              return { ...m, mtime: s.mtime.getTime() }
            } catch {
              return { ...m, mtime: 0 }
            }
          })
        )
        withStats.sort((a, b) => b.mtime - a.mtime)
        if (withStats.length > 0 && withStats[0].mtime > 0) return withStats[0].path
      } catch {}
    }
  }
  return null
}

/**
 * Get the current backup directory (Vercel-aware).
 */
export function getBackupDir(): string {
  return BACKUP_DIR
}

/**
 * Get the download directory (Vercel-aware).
 */
export function getDownloadDir(): string {
  return DOWNLOAD_DIR
}

/**
 * Whether we're running on Vercel.
 */
export function isVercel(): boolean {
  return IS_VERCEL
}
