/**
 * /api/backup/download — UPGRADE #118
 * Serves the latest full backup ZIP file.
 *
 * Security: requires OWNER_BACKUP_TOKEN env var (same as /api/owner-backup).
 *
 * GET /api/backup/download?token=<OWNER_BACKUP_TOKEN>
 *
 * Returns the backup ZIP file as a downloadable attachment.
 *
 * NOTE: The backup file is stored in public/Agent007-Backup.zip which is
 * bundled with the Vercel deployment. It's also accessible directly at
 * /Agent007-Backup.zip (no auth), but this endpoint adds token auth.
 *
 * If you need the latest backup with live data, run the backup generator
 * locally and redeploy:
 *   python3 scripts/generate-full-backup.py
 *   cp download/Agent007-Backup-*.zip public/Agent007-Backup.zip
 *   npx vercel deploy --prod
 */
import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

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

  // The backup file is in public/ which is bundled with the deployment.
  // On Vercel, process.cwd() is the deployment root.
  // Try multiple paths to find the backup file.
  const possiblePaths = [
    path.join(process.cwd(), 'public', 'Agent007-Backup.zip'),
    path.join(process.cwd(), 'Agent007-Backup.zip'),
    '/home/z/my-project/public/Agent007-Backup.zip',
    '/home/z/my-project/download/Agent007-Backup.zip',
  ]

  let backupFile: string | null = null
  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).size > 0) {
        backupFile = p
        break
      }
    } catch {}
  }

  // If no backup file found, return a helpful error with the direct download URL
  if (!backupFile) {
    return NextResponse.json({
      ok: false,
      error: 'No backup file found on the server.',
      hint: 'The backup is available as a static file at: https://agent007-ai.vercel.app/Agent007-Backup.zip',
      staticUrl: 'https://agent007-ai.vercel.app/Agent007-Backup.zip',
    }, { status: 404 })
  }

  // Read the file
  const fileBuffer = fs.readFileSync(backupFile)
  const fileName = 'Agent007-Backup.zip'

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
