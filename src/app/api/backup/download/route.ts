/**
 * /api/backup/download — UPGRADE #118
 * Serves the latest full backup ZIP file.
 *
 * Security: requires OWNER_BACKUP_TOKEN env var (same as /api/owner-backup).
 *
 * GET /api/backup/download?token=<OWNER_BACKUP_TOKEN>
 *
 * Returns the backup ZIP file as a downloadable attachment.
 */
import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const BACKUP_DIR = '/home/z/my-project/download'
const PUBLIC_BACKUP = '/home/z/my-project/public/Agent007-Backup.zip'

export async function GET(req: NextRequest) {
  // Auth: require owner token
  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  const expectedToken = process.env.OWNER_BACKUP_TOKEN || ''

  if (!expectedToken) {
    return NextResponse.json({
      ok: false,
      error: 'OWNER_BACKUP_TOKEN env var is not set. Set it in Vercel → Settings → Environment Variables.',
    }, { status: 500 })
  }

  if (token !== expectedToken) {
    return NextResponse.json({
      ok: false,
      error: 'Invalid or missing token. Pass ?token=<OWNER_BACKUP_TOKEN> in the URL.',
    }, { status: 403 })
  }

  // Find the latest backup ZIP
  let backupFile: string | null = null

  // Try the public dir first (static, always available)
  if (fs.existsSync(PUBLIC_BACKUP)) {
    backupFile = PUBLIC_BACKUP
  }

  // Then try the download dir (find the most recent ZIP)
  if (!backupFile && fs.existsSync(BACKUP_DIR)) {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('Agent007-Backup-') && f.endsWith('.zip'))
      .map(f => ({
        name: f,
        path: path.join(BACKUP_DIR, f),
        mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime)

    if (files.length > 0) {
      backupFile = files[0].path
    }
  }

  if (!backupFile || !fs.existsSync(backupFile)) {
    return NextResponse.json({
      ok: false,
      error: 'No backup file found. Run the backup generator first: python3 scripts/generate-full-backup.py',
    }, { status: 404 })
  }

  // Read the file
  const fileBuffer = fs.readFileSync(backupFile)
  const fileName = path.basename(backupFile)

  // Return as downloadable attachment
  return new NextResponse(fileBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': String(fileBuffer.length),
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  })
}
