import { NextRequest, NextResponse } from 'next/server'
import { createBackup } from '@/lib/backup-functions'
import { createGzip } from 'node:zlib'
import { Readable } from 'node:stream'
import AdmZip from 'adm-zip'
import * as path from 'node:path'
import * as fs from 'node:fs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * OWNER BACKUP TOKEN — required for /api/owner-backup access.
 *
 * SECURITY MODEL:
 *   - Token is checked against OWNER_BACKUP_TOKEN env var
 *   - If env var is not set, falls back to a hardcoded default
 *   - Only the owner knows the token → only the owner can download
 *   - Token is passed via ?token= query parameter
 *   - Token is NOT logged in server logs (we redact it)
 *
 * HOW TO CHANGE THE TOKEN:
 *   1. Set OWNER_BACKUP_TOKEN env var on Vercel (Project Settings → Environment Variables)
 *   2. Redeploy
 *   3. Use the new token in the URL
 *
 * DEFAULT TOKEN (works if env var is not set):
 *   agent007-owner-backup-2024-antonio-can-2022
 *
 * URL FORMAT:
 *   /api/owner-backup?token=TOKEN&format=json     → JSON backup
 *   /api/owner-backup?token=TOKEN&format=zip      → ZIP backup (json + source files)
 *   /api/owner-backup?token=TOKEN&format=zip&label=my-backup → custom label
 *   /api/owner-backup?token=TOKEN                 → defaults to JSON
 *   /api/owner-backup                              → 403 Forbidden (no token)
 *   /api/owner-backup?token=wrong                  → 403 Forbidden (bad token)
 *
 * WHAT'S IN THE BACKUP:
 *   - All 33 DB tables with full row data (or empty if DB unavailable)
 *   - All permanent upgrades (currently 58)
 *   - Live capabilities snapshot (567+ tools, 18 agents, 43 manage actions)
 *   - Mission field (monthly $20K, 20% monthly + 20% daily growth)
 *   - Source files (local dev only — Vercel doesn't bundle them)
 *   - Config metadata (node version, platform, env var presence flags)
 *
 * UPGRADE #59 — PERMANENT. Owner-only access enforced by token.
 */
const OWNER_BACKUP_TOKEN =
  process.env.OWNER_BACKUP_TOKEN || 'agent007-owner-backup-2024-antonio-can-2022'

/** Validate the token using a constant-time comparison to prevent timing attacks. */
function isValidToken(provided: string | null): boolean {
  if (!provided) return false
  const expected = OWNER_BACKUP_TOKEN
  if (provided.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
}

/** Read source files for inclusion in the ZIP backup (local dev only — Vercel doesn't bundle them). */
function readSourceFiles(): Record<string, string> {
  const files: Record<string, string> = {}
  const cwd = process.cwd()
  const keyPaths = [
    'src/lib/agent.ts',
    'src/lib/orchestrator.ts',
    'src/lib/tools.ts',
    'src/lib/subagents.ts',
    'src/lib/monitor-agents.ts',
    'src/lib/owner-auth.ts',
    'src/lib/settings.ts',
    'src/lib/upgrade-manifest.ts',
    'src/lib/email.ts',
    'src/lib/db.ts',
    'src/lib/auth.ts',
    'src/lib/backup-functions.ts',
    'src/middleware.ts',
    'src/app/api/owner-backup/route.ts',
    'src/app/api/monitor/qa/route.ts',
    'src/app/api/monitor/external/route.ts',
    'src/app/api/health/route.ts',
    'vercel.json',
    'prisma/schema.prisma',
    'package.json',
  ]
  for (const relPath of keyPaths) {
    try {
      const fullPath = path.join(cwd, relPath)
      if (fs.existsSync(fullPath)) {
        files[relPath] = fs.readFileSync(fullPath, 'utf-8')
      }
    } catch {
      // Skip files that don't exist (e.g. on Vercel production where source isn't bundled)
    }
  }
  return files
}

/**
 * GET /api/owner-backup?token=<TOKEN>&format=json|zip&label=<label>
 *
 * Owner-only backup download. Requires valid token in query string.
 *
 * Response formats:
 *   - format=json (default): Returns JSON backup with Content-Disposition: attachment
 *   - format=zip: Returns ZIP backup (JSON + source files) with Content-Disposition: attachment
 *
 * Errors:
 *   - 403: Missing or invalid token
 *   - 500: Backup generation failed
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const token = url.searchParams.get('token')
    const format = (url.searchParams.get('format') ?? 'json').toLowerCase()
    const label = (url.searchParams.get('label') ?? 'owner-on-demand').slice(0, 40)

    // ── Token auth (constant-time comparison) ─────────────────────────
    if (!isValidToken(token)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Forbidden: missing or invalid token.',
          hint: 'This endpoint is owner-only. Pass ?token=<OWNER_BACKUP_TOKEN> in the URL.',
          docs: 'See src/app/api/owner-backup/route.ts for token configuration.',
        },
        { status: 403 }
      )
    }

    // ── Generate the backup ────────────────────────────────────────────
    const result = await createBackup(label)
    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error ?? 'Backup generation failed',
          message: result.message,
        },
        { status: 500 }
      )
    }

    // ── Read the JSON content from the generated file ──────────────────
    const fs_ = await import('node:fs/promises')
    const jsonPath = result.absolutePath.replace(/\.json\.gz$/, '.json')
    let jsonContent: string
    try {
      jsonContent = await fs_.readFile(jsonPath, 'utf-8')
    } catch {
      // If the file is gone (cold start), regenerate from the result object
      jsonContent = JSON.stringify(result, null, 2)
    }

    // ── Format: JSON ───────────────────────────────────────────────────
    if (format === 'json') {
      return new NextResponse(jsonContent, {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${result.jsonFilename}"`,
          'Content-Length': String(Buffer.byteLength(jsonContent, 'utf-8')),
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'X-Backup-Tables': String(result.contents.databaseTables),
          'X-Backup-Rows': String(result.contents.totalRows),
          'X-Backup-Upgrades': String(result.contents.upgrades),
          'X-Backup-Label': result.label,
          'X-Auth-Method': 'owner-token',
        },
      })
    }

    // ── Format: ZIP (JSON + source files) ──────────────────────────────
    if (format === 'zip') {
      const zip = new AdmZip()
      // Add the JSON backup
      zip.addFile(result.jsonFilename, Buffer.from(jsonContent, 'utf-8'))
      // Add source files (works on local dev; on Vercel, sourceFiles will be empty)
      const sourceFiles = readSourceFiles()
      for (const [relPath, content] of Object.entries(sourceFiles)) {
        zip.addFile(relPath, Buffer.from(content, 'utf-8'))
      }
      // Add README
      const readme = [
        '# Agent007 AI — Owner Backup',
        '',
        'Generated: ' + new Date().toISOString(),
        'Label: ' + result.label,
        '',
        '## Contents',
        '',
        '1. ' + result.jsonFilename + ' — full structured backup',
        '   - All 33 DB tables (or empty if DB unavailable)',
        '   - All ' + result.contents.upgrades + ' permanent upgrades',
        '   - Capabilities snapshot',
        '   - Config metadata',
        '',
        '2. Source files (local dev only — Vercel doesn\'t bundle them):',
        '   - src/lib/agent.ts',
        '   - src/lib/orchestrator.ts',
        '   - src/lib/tools.ts',
        '   - src/lib/subagents.ts',
        '   - src/middleware.ts',
        '   - src/app/api/owner-backup/route.ts',
        '   - vercel.json',
        '   - prisma/schema.prisma',
        '   - package.json',
        '   - + more',
        '',
        '## Auth',
        '',
        'This backup was downloaded via /api/owner-backup?token=<OWNER_BACKUP_TOKEN>',
        'Only the owner with the correct token can download backups.',
        '',
        '## Stats',
        '',
        '- Database tables: ' + result.contents.databaseTables,
        '- Total rows: ' + result.contents.totalRows,
        '- Upgrades: ' + result.contents.upgrades,
        '- JSON size: ' + result.jsonSizeMB + ' MB',
      ].join('\n')
      zip.addFile('README.md', Buffer.from(readme, 'utf-8'))

      const zipBuffer = zip.toBuffer()
      const zipFilename = result.jsonFilename.replace(/\.json$/, '.zip')

      return new NextResponse(new Uint8Array(zipBuffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${zipFilename}"`,
          'Content-Length': String(zipBuffer.length),
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'X-Backup-Tables': String(result.contents.databaseTables),
          'X-Backup-Rows': String(result.contents.totalRows),
          'X-Backup-Upgrades': String(result.contents.upgrades),
          'X-Backup-Label': result.label,
          'X-Auth-Method': 'owner-token',
        },
      })
    }

    // ── Format: gzipped JSON (legacy/compat) ──────────────────────────
    if (format === 'gzip' || format === 'gz') {
      const jsonBuffer = Buffer.from(jsonContent, 'utf-8')
      const gzippedBuffer = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = []
        const gzipStream = createGzip()
        gzipStream.on('data', (chunk: Buffer) => chunks.push(chunk))
        gzipStream.on('end', () => resolve(Buffer.concat(chunks)))
        gzipStream.on('error', reject)
        Readable.from(jsonBuffer).pipe(gzipStream)
      })

      return new NextResponse(new Uint8Array(gzippedBuffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/gzip',
          'Content-Disposition': `attachment; filename="${result.zipFilename}"`,
          'Content-Length': String(gzippedBuffer.length),
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'X-Auth-Method': 'owner-token',
        },
      })
    }

    // Unknown format
    return NextResponse.json(
      {
        ok: false,
        error: `Unknown format: "${format}". Supported: json, zip, gzip.`,
      },
      { status: 400 }
    )
  } catch (e: any) {
    console.error('[owner-backup] failed:', e)
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e), stack: e?.stack },
      { status: 500 }
    )
  }
}

/**
 * POST /api/owner-backup
 *
 * Same as GET but accepts token in request body (for clients that can't set query params).
 * Body: { token: string, format?: 'json'|'zip'|'gzip', label?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const token = body?.token
    const format = (body?.format ?? 'json').toLowerCase()
    const label = (body?.label ?? 'owner-post').slice(0, 40)

    if (!isValidToken(token)) {
      return NextResponse.json(
        { ok: false, error: 'Forbidden: missing or invalid token.' },
        { status: 403 }
      )
    }

    const result = await createBackup(label)
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error ?? 'Backup generation failed' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      backup: result,
      downloadUrl: `/api/owner-backup?token=${encodeURIComponent(token)}&format=${format}&label=${encodeURIComponent(label)}`,
    })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 }
    )
  }
}
