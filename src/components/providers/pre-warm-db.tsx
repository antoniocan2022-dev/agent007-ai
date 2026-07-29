'use client'

/**
 * PreWarmDb.tsx — UPGRADE #148 (Issue 2c fix) + UPGRADE #169 H3
 * ===================================================================
 * Fires 3 lightweight parallel fetches as early as possible on page
 * load — BEFORE useSession() resolves and BEFORE the dashboard's own
 * fetches fire.
 *
 * Why this helps:
 *   - On Vercel cold starts, EACH serverless function has its own
 *     cold-start DB init cost (~5-10s).
 *   - The 3 endpoints the dashboard actually loads are: /api/conversations,
 *     /api/memory, /api/subagents — NOT /api/health (which was a NO-OP
 *     that didn't touch the DB).
 *   - By firing all 3 in parallel immediately, we warm each function's
 *     Lambda + Prisma cache in parallel with the NextAuth session check,
 *     hiding ~5-10s of latency behind the auth redirect.
 *
 * UPGRADE #169 H3: Replaced the no-op /api/health call with the 3 real
 * DB-touching endpoints. /api/health returns a static JSON without
 * touching the database, so warming it did nothing useful. The new
 * approach warms the SAME endpoints the dashboard will load, so the
 * dashboard's actual fetches hit warm Lambdas.
 *
 * This component renders nothing visible — it's a side-effect-only
 * mount hook. It's placed in layout.tsx so it runs on every page.
 *
 * Note: All 3 endpoints are auth-protected — they'll 401 on first hit
 * (no session yet), but the Lambda + Prisma connection will still be
 * warmed. The 401 response is silent.
 */

import { useEffect } from 'react'

export function PreWarmDb() {
  useEffect(() => {
    // UPGRADE #169 H3 + #170 fix #5: Fire the 3 real DB-touching endpoints
    // in parallel instead of /api/health (which was a NO-OP). Even though
    // they 401 (no session yet), the Lambda + Prisma connection is warmed.
    //
    // #170 fix #5: BEFORE — the cleanup `controller.abort()` was dead code
    // because the fetches only used `AbortSignal.timeout(15_000)` and the
    // controller's signal was never passed to fetches. On rapid page
    // navigation, each PreWarmDb mount fired 3 unabortable fetches that
    // held connections for up to 15s each.
    // AFTER — we use `AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)])`
    // so both the unmount cleanup AND the 15s timeout can abort the fetch.
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)])
    const endpoints = ['/api/conversations?limit=1', '/api/memory?limit=1', '/api/subagents']
    Promise.allSettled(
      endpoints.map((path) =>
        fetch(path, {
          method: 'GET',
          signal,
        }).catch(() => {
          // Silent — 401 or any error is fine, we just want to warm the Lambda
        })
      )
    ).catch(() => {
      // Silent — this is a best-effort optimization, not critical
    })
    return () => controller.abort()
  }, [])

  return null  // Renders nothing
}
