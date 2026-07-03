import { NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/system/clear-cache
 *
 * Clears the .next build cache to fix stale HTML hydration errors.
 * Agent007 can call this when hydration errors occur due to cached
 * old server-rendered HTML not matching new client code.
 *
 * After clearing, the next request will trigger a fresh recompile.
 *
 * Body: { force?: boolean }
 * Returns: { ok, cleared, message }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const force = body.force === true

    const projectRoot = process.cwd()
    const nextDir = path.join(projectRoot, '.next')
    const results: string[] = []

    // 1. Delete .next cache directory
    try {
      if (fs.existsSync(nextDir)) {
        fs.rmSync(nextDir, { recursive: true, force: true })
        results.push('.next cache directory deleted')
      } else {
        results.push('.next cache directory did not exist')
      }
    } catch (e: any) {
      results.push(`Failed to delete .next: ${e?.message ?? e}`)
    }

    // 2. Also clear /tmp file settings cache (forces fresh load from DB)
    // NOTE: We do NOT delete /tmp/.agent007-settings.json because it contains
    // the owner's custom settings. We only clear the .next build cache.
    if (force) {
      try {
        const tmpSettings = '/tmp/.agent007-upgrades.json'
        if (fs.existsSync(tmpSettings)) {
          fs.unlinkSync(tmpSettings)
          results.push('Cleared /tmp upgrade cache (will reload from manifest)')
        }
      } catch {}
    }

    return NextResponse.json({
      ok: true,
      cleared: true,
      message: `✅ Build cache cleared. ${results.join('. ')}. The next page load will trigger a fresh compile. If you still see hydration errors, hard-refresh your browser (Ctrl+Shift+R or Cmd+Shift+R).`,
      results,
      timestamp: new Date().toISOString(),
    })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e), cleared: false },
      { status: 500 }
    )
  }
}

/**
 * GET /api/system/clear-cache
 * Returns the current cache status.
 */
export async function GET() {
  const projectRoot = process.cwd()
  const nextDir = path.join(projectRoot, '.next')
  let cacheSize = 0
  let cacheExists = false

  try {
    if (fs.existsSync(nextDir)) {
      cacheExists = true
      // Get approximate size
      const calcSize = (dir: string): number => {
        let total = 0
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            total += calcSize(fullPath)
          } else {
            try {
              total += fs.statSync(fullPath).size
            } catch {}
          }
        }
        return total
      }
      cacheSize = calcSize(nextDir)
    }
  } catch {}

  return NextResponse.json({
    cacheExists,
    cacheSizeMB: cacheExists ? (cacheSize / (1024 * 1024)).toFixed(2) : '0',
    message: cacheExists
      ? `.next cache exists (${(cacheSize / (1024 * 1024)).toFixed(2)} MB). POST to clear.`
      : 'No .next cache. Next request will compile fresh.',
  })
}
