import { NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/_warm
 *
 * UPGRADE #185: Public endpoint that warms the DB + Lambda.
 * PreWarmDb fires this on page load so the DB connection is ready
 * BEFORE the user clicks any tab. Without this, each tab's first
 * API call pays the full cold-start + DB init cost (3-5s each).
 *
 * This endpoint is PUBLIC (no auth) — it only runs a trivial DB
 * count query. No user data is exposed.
 */
export async function GET() {
  try {
    await ensureDbReady().catch(() => {})

    // Run a trivial query on each major table to warm the Prisma connection
    const counts: Record<string, number> = {}
    const tables = ['user', 'conversation', 'message', 'memory', 'customSubagent', 'schedule', 'incomeEntry', 'apiKey', 'phoneConfig']

    for (const table of tables) {
      try {
        const model = (db as any)[table]
        if (model && typeof model.count === 'function') {
          counts[table] = await model.count()
        }
      } catch {
        // Table might not exist yet — skip
      }
    }

    return NextResponse.json({
      ok: true,
      warmed: true,
      timestamp: new Date().toISOString(),
      tables: Object.keys(counts).length,
    })
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: e?.message?.slice(0, 100) ?? 'warm failed',
    }, { status: 500 })
  }
}
