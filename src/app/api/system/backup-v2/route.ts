import { NextRequest, NextResponse } from 'next/server'
import { gzipSync } from 'node:zlib'
import { createBackupV2, inspectBackupV2, restoreBackupV2 } from '@/lib/backup-v2'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Backup V2.1 is intentionally protected by the normal application middleware.
 * It contains sensitive enterprise state and must never be added to the public whitelist.
 *
 * GET ?format=json|gzip       -> complete DB export with encrypted secret columns when configured
 * POST {mode:'inspect',backup} -> validate integrity/schema without mutation
 * POST {mode:'restore',backup,dryRun:true} -> additive recovery preview
 * POST {mode:'restore',backup,dryRun:false} -> additive recovery (never deletes)
 */
export async function GET(req: NextRequest) {
  try {
    const format = new URL(req.url).searchParams.get('format') ?? 'json'
    if (format !== 'json' && format !== 'gzip') {
      return NextResponse.json({ ok: false, error: 'format must be json or gzip' }, { status: 400 })
    }

    const backup = await createBackupV2()
    const json = JSON.stringify(backup, null, 2)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')

    if (format === 'gzip') {
      const compressed = gzipSync(Buffer.from(json, 'utf8'), { level: 9 })
      return new NextResponse(compressed as unknown as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': 'application/gzip',
          'Content-Disposition': `attachment; filename="agent007-backup-v2-${stamp}.json.gz"`,
          'Cache-Control': 'no-store, private',
          'X-Agent007-Backup-Version': '2.1',
          'X-Agent007-Backup-Checksum': backup.integrity.checksum,
        },
      })
    }

    return new NextResponse(json, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="agent007-backup-v2-${stamp}.json"`,
        'Cache-Control': 'no-store, private',
        'X-Agent007-Backup-Version': '2.1',
        'X-Agent007-Backup-Checksum': backup.integrity.checksum,
      },
    })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? 'Backup V2 generation failed' },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const mode = body?.mode ?? 'inspect'
    const backup = body?.backup ?? body

    if (mode === 'inspect') {
      return NextResponse.json({ ok: true, ...await inspectBackupV2(backup) }, { status: 200 })
    }

    if (mode === 'restore') {
      const dryRun = body?.dryRun !== false
      const result = await restoreBackupV2(backup, dryRun)
      return NextResponse.json({ ok: true, ...result }, { status: 200 })
    }

    return NextResponse.json({ ok: false, error: 'mode must be inspect or restore' }, { status: 400 })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? 'Backup V2 operation failed' },
      { status: 400 },
    )
  }
}
