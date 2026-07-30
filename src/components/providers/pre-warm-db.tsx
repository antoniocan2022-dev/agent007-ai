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
    // UPGRADE #185: Use the dedicated /api/warm endpoint instead of
    // auth-protected routes. The old PreWarmDb fired /api/conversations,
    // /api/memory, /api/subagents — but the first 2 are auth-protected,
    // so middleware 307-redirected them and the Lambda was NEVER invoked.
    // Only /api/subagents (public) actually got warmed.
    //
    // /api/warm is PUBLIC and runs ensureDbReady() + trivial count()
    // queries on all major tables. This warms the Prisma connection pool
    // so when the user clicks a tab, the DB is already connected.
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)])
    fetch('/api/warm', { method: 'GET', signal })
      .catch(() => {
        // Silent — best-effort warming
      })
    return () => controller.abort()
  }, [])

  return null  // Renders nothing
}
