'use client'

/**
 * PreWarmDb.tsx — UPGRADE #148 (Issue 2c fix)
 * ===================================================================
 * Fires a lightweight `/api/health` fetch as early as possible on page
 * load — BEFORE useSession() resolves and BEFORE the dashboard's parallel
 * fetches fire.
 *
 * Why this helps:
 *   - On Vercel cold starts, the FIRST request to a serverless function
 *     pays the full DB init cost (~6-12s for createTables + seedData).
 *   - Subsequent requests to the SAME warm instance are fast (~50ms).
 *   - By firing /api/health immediately, we start the cold-start DB init
 *     in parallel with the NextAuth session check, hiding ~5-10s of
 *     latency behind the auth redirect.
 *
 * This component renders nothing visible — it's a side-effect-only
 * mount hook. It's placed in layout.tsx so it runs on every page.
 *
 * Note: /api/health is chosen because:
 *   1. It's public (no auth required) — won't 307 redirect
 *   2. It calls ensureDbReady() implicitly via db.user.findFirst
 *   3. It returns a small JSON payload (no heavy work)
 *   4. It's already deployed and known to work
 */

import { useEffect } from 'react'

export function PreWarmDb() {
  useEffect(() => {
    // Fire-and-forget — we don't care about the response, we just want
    // to trigger the cold-start DB init ASAP.
    fetch('/api/health', {
      method: 'GET',
      // Don't block page unload if user navigates away
      signal: AbortSignal.timeout(30_000),
    }).catch(() => {
      // Silent — this is a best-effort optimization, not critical
    })
  }, [])

  return null  // Renders nothing
}
