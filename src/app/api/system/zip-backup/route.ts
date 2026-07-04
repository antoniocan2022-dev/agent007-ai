import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { promises as fsp, readFileSync } from 'node:fs'
import path from 'node:path'
import { stat } from 'node:fs/promises'
import { execSync } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BACKUP_DIR = '/home/z/my-project/download/backups'
const DOWNLOAD_DIR = '/home/z/my-project/download'

async function findBackupFile(filename: string): Promise<string | null> {
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

  if (safeFile.includes('full-backup') || safeFile.includes('full-system')) {
    for (const dir of searchDirs) {
      try {
        const files = await fsp.readdir(dir)
        const ext = path.extname(safeFile)
        const matching = files.filter(f => f.endsWith(ext) && f.includes('backup')).map(f => ({ name: f, path: path.join(dir, f) }))
        const withStats = await Promise.all(
          matching.map(async m => {
            try { const s = await stat(m.path); return { ...m, mtime: s.mtime.getTime() } }
            catch { return { ...m, mtime: 0 } }
          })
        )
        withStats.sort((a, b) => b.mtime - a.mtime)
        if (withStats.length > 0 && withStats[0].mtime > 0) return withStats[0].path
      } catch {}
    }
  }
  return null
}

export async function GET(req: NextRequest) {
  try {
    await ensureDbReady()
    const url = new URL(req.url)
    const download = url.searchParams.get('download')

    if (download) {
      const safeFile = path.basename(download)
      const filepath = await findBackupFile(safeFile)
      if (!filepath) {
        const available: string[] = []
        for (const dir of [BACKUP_DIR, DOWNLOAD_DIR]) {
          try {
            const files = await fsp.readdir(dir)
            for (const f of files) {
              if (f.endsWith('.zip') || f.endsWith('.json')) available.push(f)
            }
          } catch {}
        }
        return NextResponse.json({ error: `Backup file not found: ${safeFile}`, availableFiles: [...new Set(available)] }, { status: 404 })
      }
      const statRes = await stat(filepath)
      const ext = path.extname(filepath).toLowerCase()
      const contentType = ext === '.zip' ? 'application/zip' : ext === '.gz' ? 'application/gzip' : ext === '.json' ? 'application/json' : 'application/octet-stream'
      const buffer = await fsp.readFile(filepath)
      return new NextResponse(buffer, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${path.basename(filepath)}"`,
          'Content-Length': String(statRes.size),
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      })
    }

    const backups: Array<{ name: string; size: string; sizeBytes: number; created: string; path: string }> = []
    const seenFiles = new Set<string>()
    for (const dir of [BACKUP_DIR, DOWNLOAD_DIR]) {
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
              backups.push({ name: f, size: `${(statRes.size / 1024 / 1024).toFixed(2)} MB`, sizeBytes: statRes.size, created: statRes.mtime.toISOString(), path: `/api/system/zip-backup?download=${encodeURIComponent(f)}` })
            }
          } catch {}
        }
      } catch {}
    }
    backups.sort((a, b) => b.created.localeCompare(a.created))
    return NextResponse.json({ ok: true, backups, count: backups.length, downloadBaseUrl: '/api/system/zip-backup?download=', message: `${backups.length} backup(s) available` })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureDbReady()
    const body = await req.json().catch(() => ({}))
    const label = (body.label ?? 'full-system').toString().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)
    const userId = (await db.user.findFirst({ orderBy: { createdAt: 'asc' } }))?.id
    if (!userId) return NextResponse.json({ ok: false, error: 'No operator user found' }, { status: 500 })

    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    await fsp.mkdir(BACKUP_DIR, { recursive: true })

    const dbExport: Record<string, any> = {}
    const tableNames = ['conversation','message','memory','user','userSetting','incomeEntry','transaction','knowledgeDoc','knowledgeChunk','schedule','notificationLog','pendingManageAction','customSubagent','auditLog','twoFactorSecret','phoneConfig','incomingCommand','bankAccount','payPalAccount','apiKey','customer','marketingCampaign','partnership','businessStrategy','missionTracker','servicePackage','opportunity','prediction','systemHealth','mLModel','riskRegister','complianceCheck','contractDraft']
    const tableCounts: Record<string, number> = {}
    for (const table of tableNames) {
      try { const rows = await (db as any)[table].findMany(); dbExport[table] = rows; tableCounts[table] = rows.length }
      catch { dbExport[table] = []; tableCounts[table] = -1 }
    }

    const { getAllUpgrades } = await import('@/lib/upgrade-manifest')
    const upgrades = getAllUpgrades()

    let capabilities: any = null
    try { const capRes = await fetch(`http://localhost:${process.env.PORT ?? 3000}/api/system/capabilities`, { signal: AbortSignal.timeout(5000) }); capabilities = await capRes.json().catch(() => null) } catch {}

    const sourceFiles: Record<string, string> = {}
    const keyPaths = ['src/lib/agent.ts','src/lib/orchestrator.ts','src/lib/tools.ts','src/lib/subagents.ts','src/lib/owner-auth.ts','src/lib/settings.ts','src/lib/upgrade-manifest.ts','src/lib/self-backup.ts','src/lib/email.ts','src/lib/whatsapp-bridge.ts','src/lib/db.ts','src/lib/auth.ts','src/app/login/page.tsx','src/app/page.tsx','src/components/agent/tabs/dashboard-tab.tsx','src/components/agent/tabs/settings-tab.tsx','prisma/schema.prisma','package.json','next.config.ts','tsconfig.json','tailwind.config.ts']
    for (const relPath of keyPaths) {
      try { const fullPath = path.join(process.cwd(), relPath); sourceFiles[relPath] = readFileSync(fullPath, 'utf-8') } catch {}
    }

    const backup = {
      version: '4.0', app: 'Agent007 AI', exportedAt: new Date().toISOString(), label,
      mission: { monthlyIncomeTarget: 20000, monthlyGrowthRate: 20, dailyGrowthTarget: 10 },
      capabilities: capabilities?.summary ?? null,
      upgrades: { total: upgrades.length, integrityOk: true, list: upgrades },
      database: { exportedAt: new Date().toISOString(), tableCount: tableNames.length, counts: tableCounts, totalRows: Object.values(tableCounts).reduce((s: number, c) => s + (c > 0 ? c : 0), 0), data: dbExport },
      sourceCode: { fileCount: Object.keys(sourceFiles).length, files: sourceFiles },
      config: { nodeVersion: process.version, platform: process.platform, nextAuthConfigured: !!process.env.NEXTAUTH_SECRET, smtpConfigured: !!(process.env.SMTP_HOST && process.env.SMTP_PORT), openaiConfigured: !!process.env.OPENAI_API_KEY, vercelUrl: process.env.NEXTAUTH_URL ?? 'not set' },
    }

    const jsonFilename = `agent007-backup-${ts}-${label}.json`
    const jsonFilepath = path.join(BACKUP_DIR, jsonFilename)
    const jsonContent = JSON.stringify(backup, null, 2)
    await fsp.writeFile(jsonFilepath, jsonContent, 'utf-8')
    const jsonSizeMB = (jsonContent.length / 1024 / 1024).toFixed(2)

    let zipFilename: string | null = null
    let zipSizeMB: string | null = null
    try {
      zipFilename = `agent007-backup-${ts}-${label}.zip`
      execSync(`cd ${BACKUP_DIR} && zip -j "${zipFilename}" "${jsonFilename}"`, { stdio: 'pipe' })
      const zipStat = await stat(path.join(BACKUP_DIR, zipFilename))
      zipSizeMB = (zipStat.size / 1024 / 1024).toFixed(2)
    } catch {
      try {
        const gzipFilename = `agent007-backup-${ts}-${label}.json.gz`
        const gzipFilepath = path.join(BACKUP_DIR, gzipFilename)
        const { createReadStream, createWriteStream } = await import('node:fs')
        await pipeline(createReadStream(jsonFilepath), createGzip(), createWriteStream(gzipFilepath))
        const gzStat = await stat(gzipFilepath)
        zipFilename = gzipFilename; zipSizeMB = (gzStat.size / 1024 / 1024).toFixed(2)
      } catch { zipFilename = jsonFilename; zipSizeMB = jsonSizeMB }
    }

    try { await db.auditLog.create({ data: { userId, action: 'zip_backup_created', entity: 'system', description: `ZIP backup created: ${zipFilename} (${zipSizeMB}MB)` } }) } catch {}

    return NextResponse.json({ ok: true, label, jsonFilename, jsonSizeMB, zipFilename, zipSizeMB, downloadUrl: `/api/system/zip-backup?download=${zipFilename}`, absolutePath: path.join(BACKUP_DIR, zipFilename ?? jsonFilename), contents: { databaseTables: tableNames.length, totalRows: backup.database.totalRows, sourceFiles: Object.keys(sourceFiles).length, upgrades: upgrades.length, capabilities: capabilities?.summary }, message: `Backup created: ${zipFilename} (${zipSizeMB}MB)`, timestamp: new Date().toISOString() })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 })
  }
}
