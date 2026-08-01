/**
 * /api/backup/download-source — UPGRADE #205
 *
 * Generates a source-code backup ZIP on-demand and streams it to the client.
 * PRIVATE: requires session authentication (only Antonio can access when logged in).
 * NO files stored in public/ — generated on-the-fly, streamed directly to browser.
 *
 * What's included (~7MB):
 * - src/ (all source code)
 * - scripts/ (all audit/deploy/patch scripts)
 * - public/ (icons, manifest, agent007-charter.md)
 * - prisma/ (database schema)
 * - Config files (package.json, tsconfig.json, vercel.json, etc.)
 *
 * What's NOT included:
 * - .git/ (244MB — too large for on-demand generation on Vercel)
 * - node_modules/ (1.4GB — regeneratable via npm install)
 * - .next/ (build output)
 *
 * For the full backup with .git/ history, run locally:
 *   bash scripts/create-full-backup.sh
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSessionUserId } from '@/lib/session-user'
import * as fs from 'node:fs'
import * as path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  // ═══ AUTH: Only authenticated users (Antonio) can download ═══
  const userId = await getSessionUserId()
  if (!userId) {
    return NextResponse.json({
      ok: false,
      error: 'Not authenticated. Log in to download backups.',
    }, { status: 401 })
  }

  // ═══ Collect all source files ═══
  const cwd = process.cwd()
  const dirsToInclude = ['src', 'scripts', 'public', 'prisma']
  const filesToInclude = [
    'package.json', 'package-lock.json', 'bun.lock',
    'tsconfig.json', 'next.config.ts', 'vercel.json',
    '.gitignore', '.vercelignore',
    'tailwind.config.ts', 'postcss.config.mjs', 'eslint.config.mjs',
    'components.json', 'Caddyfile', 'README.md', 'QUICKSTART.md',
    'POSTGRES-SETUP.md',
  ]

  const excludePatterns = [
    /node_modules/, /\.next/, /\.git\//, /\/download\//, /\/tool-results\//,
    /\/audit\//, /\/audit-v2\//, /\/upload\//, /\/db\//, /\/backups\//,
    /\.log$/, /dev\.pid$/, /\.db$/, /\.db-journal$/,
  ]

  const shouldExclude = (filePath: string): boolean => excludePatterns.some(p => p.test(filePath))

  const allFiles: Array<{ path: string; content: Buffer }> = []

  for (const dir of dirsToInclude) {
    const dirPath = path.join(cwd, dir)
    if (!fs.existsSync(dirPath)) continue
    const walk = (currentPath: string, relativeTo: string) => {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name)
        const relPath = path.join(relativeTo, entry.name)
        if (shouldExclude(relPath)) continue
        if (entry.isDirectory()) { walk(fullPath, relPath) }
        else if (entry.isFile()) {
          try {
            const content = fs.readFileSync(fullPath)
            if (content.length > 5 * 1024 * 1024) continue
            allFiles.push({ path: relPath, content })
          } catch {}
        }
      }
    }
    walk(dirPath, dir)
  }

  for (const file of filesToInclude) {
    const filePath = path.join(cwd, file)
    if (fs.existsSync(filePath)) {
      try { allFiles.push({ path: file, content: fs.readFileSync(filePath) }) } catch {}
    }
  }

  // ═══ Generate ZIP on-the-fly ═══
  const AdmZip = (await import('adm-zip')).default
  const zip = new AdmZip()
  for (const file of allFiles) { zip.addFile(file.path, file.content) }

  const manifest = {
    generated: new Date().toISOString(),
    version: 'upgrade-205',
    file_count: allFiles.length,
    description: 'Agent007 AI source code backup (authenticated download)',
    includes: ['src/', 'scripts/', 'public/', 'prisma/', 'config files'],
    excludes: ['.git/ (too large for Vercel)', 'node_modules/ (regeneratable)', '.next/ (build output)'],
    fixes: '#197 through #205',
    note: 'For full backup with .git/ history, run scripts/create-full-backup.sh locally',
  }
  zip.addFile('BACKUP-MANIFEST.json', Buffer.from(JSON.stringify(manifest, null, 2)))

  const zipBuffer = zip.toBuffer()
  const fileName = `agent007-source-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`

  return new NextResponse(new Uint8Array(zipBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': String(zipBuffer.length),
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  })
}
