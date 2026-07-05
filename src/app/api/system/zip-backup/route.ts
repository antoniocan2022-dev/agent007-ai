import { NextRequest, NextResponse } from 'next/server'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { stat } from 'node:fs/promises'
import {
  createBackup,
  listBackups,
  findBackupFile,
  getBackupDir,
  getDownloadDir,
  isVercel,
} from '@/lib/backup-functions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * /api/system/zip-backup
 *
 * GET  (no params)             — list all backups (JSON)
 * GET  ?download=<filename>    — download a specific backup file
 * POST { label: "..." }        — create a new backup
 *
 * All three operations delegate to src/lib/backup-functions.ts which is
 * the CANONICAL implementation. The orchestrator's create_backup /
 * list_backups manage actions call the same functions directly (no HTTP
 * roundtrip), which fixes the "non-JSON response" error on Vercel.
 */

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const download = url.searchParams.get('download')

    if (download) {
      const safeFile = path.basename(download)
      const filepath = await findBackupFile(safeFile)
      if (!filepath) {
        // List available files to help the user
        const listResult = await listBackups()
        const availableFiles = listResult.backups.map(b => b.name)
        return NextResponse.json(
          {
            error: `Backup file not found: ${safeFile}`,
            availableFiles,
            count: availableFiles.length,
            hint: isVercel()
              ? 'Vercel uses ephemeral /tmp storage — backups created in a previous cold start may not be available. Create a new backup with POST /api/system/zip-backup.'
              : 'Check the /home/z/my-project/download/backups directory.',
          },
          { status: 404 }
        )
      }
      const statRes = await stat(filepath)
      const ext = path.extname(filepath).toLowerCase()
      const contentType =
        ext === '.zip' ? 'application/zip'
        : ext === '.gz' ? 'application/gzip'
        : ext === '.json' ? 'application/json'
        : 'application/octet-stream'
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

    // No ?download= param → return backup list
    const listResult = await listBackups()
    return NextResponse.json({
      ok: true,
      backups: listResult.backups,
      count: listResult.count,
      downloadBaseUrl: listResult.downloadBaseUrl,
      message: listResult.message,
      warning: listResult.warning,
      backupDir: getBackupDir(),
      isVercel: isVercel(),
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const label = (body.label ?? 'full-system').toString()
    // Delegate to the canonical backup function — no inline logic here
    // so the orchestrator and HTTP route always agree.
    const result = await createBackup(label)
    return NextResponse.json(result, { status: result.ok ? 200 : 500 })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 }
    )
  }
}
