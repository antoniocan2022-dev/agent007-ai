import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { promises as fsp } from 'node:fs'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BACKUP_DIR = '/home/z/my-project/download/backups'
const DOWNLOAD_DIR = '/home/z/my-project/download'

export async function POST(req: NextRequest) {
  try {
    await ensureDbReady()
    const body = await req.json().catch(() => ({}))
    let backup: any = null

    if (body.content && typeof body.content === 'object') {
      backup = body.content
    } else if (body.filename) {
      const safeFile = path.basename(body.filename)
      let filepath: string | null = null
      for (const dir of [BACKUP_DIR, DOWNLOAD_DIR]) {
        const testPath = path.join(dir, safeFile)
        try { await fsp.access(testPath); filepath = testPath; break } catch {}
      }
      if (!filepath) return NextResponse.json({ ok: false, error: `Backup file not found: ${safeFile}` }, { status: 404 })
      const content = await fsp.readFile(filepath, 'utf-8')
      backup = JSON.parse(content)
    } else if (body.latest === true) {
      const latest = await findLatestBackup()
      if (!latest) return NextResponse.json({ ok: false, error: 'No backup files found' }, { status: 404 })
      const content = await fsp.readFile(latest, 'utf-8')
      backup = JSON.parse(content)
    } else {
      return NextResponse.json({ ok: false, error: 'Provide { filename } or { content } or { latest: true }' }, { status: 400 })
    }

    if (!backup || !backup.app || backup.app !== 'Agent007 AI') {
      return NextResponse.json({ ok: false, error: 'Invalid backup file' }, { status: 400 })
    }

    const data = backup.database?.data ?? {}
    const restoreSummary: Record<string, number> = {}

    try {
      if (Array.isArray(data.memory)) {
        let count = 0
        for (const m of data.memory) {
          try { await db.memory.upsert({ where: { key: m.key }, update: { value: m.value, category: m.category }, create: { key: m.key, value: m.value, category: m.category } }); count++ } catch {}
        }
        restoreSummary.memories = count
      }
    } catch { restoreSummary.memories = -1 }

    try {
      if (Array.isArray(data.customSubagent)) {
        let count = 0
        for (const s of data.customSubagent) {
          try {
            const existing = await db.customSubagent.findFirst({ where: { id: s.id, userId: s.userId } })
            if (existing) { await db.customSubagent.update({ where: { id: existing.id }, data: { name: s.name, role: s.role, specialty: s.specialty, color: s.color, icon: s.icon, allowedTools: s.allowedTools, systemPrompt: s.systemPrompt, enabled: s.enabled } }) }
            else { await db.customSubagent.create({ data: s }) }
            count++
          } catch {}
        }
        restoreSummary.customSubagents = count
      }
    } catch { restoreSummary.customSubagents = -1 }

    try {
      if (Array.isArray(data.schedule)) {
        let count = 0
        for (const s of data.schedule) {
          try {
            const existing = await db.schedule.findFirst({ where: { id: s.id, userId: s.userId } })
            if (existing) { await db.schedule.update({ where: { id: existing.id }, data: { name: s.name, prompt: s.prompt, intervalMin: s.intervalMin, enabled: s.enabled, nextRunAt: s.nextRunAt ? new Date(s.nextRunAt) : null } }) }
            else { await db.schedule.create({ data: { ...s, nextRunAt: s.nextRunAt ? new Date(s.nextRunAt) : undefined } }) }
            count++
          } catch {}
        }
        restoreSummary.schedules = count
      }
    } catch { restoreSummary.schedules = -1 }

    try {
      if (Array.isArray(data.incomeEntry)) {
        let count = 0
        for (const e of data.incomeEntry) {
          try { const existing = await db.incomeEntry.findUnique({ where: { id: e.id } }); if (!existing) { await db.incomeEntry.create({ data: { ...e, date: e.date ? new Date(e.date) : new Date() } }); count++ } } catch {}
        }
        restoreSummary.incomeEntries = count
      }
    } catch { restoreSummary.incomeEntries = -1 }

    try {
      if (Array.isArray(data.userSetting)) {
        let count = 0
        for (const s of data.userSetting) {
          try { const existing = await db.userSetting.findFirst({ where: { userId: s.userId, key: s.key } }); if (existing) { await db.userSetting.update({ where: { id: existing.id }, data: { value: s.value } }) } else { await db.userSetting.create({ data: s }) }; count++ } catch {}
        }
        restoreSummary.userSettings = count
      }
    } catch { restoreSummary.userSettings = -1 }

    return NextResponse.json({ ok: true, message: 'Backup loaded successfully', backupVersion: backup.version, exportedAt: backup.exportedAt, label: backup.label, restored: restoreSummary, capabilities: backup.capabilities, upgrades: backup.upgrades?.total, timestamp: new Date().toISOString() })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: '/api/system/load-backup', method: 'POST', usage: { option1: { filename: 'agent007-full-backup.json' }, option2: { content: '{...}' }, option3: { latest: true } } })
}

async function findLatestBackup(): Promise<string | null> {
  for (const dir of [BACKUP_DIR, DOWNLOAD_DIR]) {
    try {
      const files = await fsp.readdir(dir)
      const jsonFiles = files.filter(f => f.endsWith('.json') && f.includes('backup'))
      if (jsonFiles.length === 0) continue
      const withStats = await Promise.all(jsonFiles.map(async f => { try { const stat = await fsp.stat(path.join(dir, f)); return { path: path.join(dir, f), mtime: stat.mtime.getTime() } } catch { return { path: '', mtime: 0 } } }))
      withStats.sort((a, b) => b.mtime - a.mtime)
      if (withStats[0].mtime > 0) return withStats[0].path
    } catch {}
  }
  return null
}
