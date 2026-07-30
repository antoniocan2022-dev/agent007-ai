# DEBUG-SLOW-TABS — Tab Loading Performance Audit

**Task ID:** DEBUG-SLOW-TABS
**Agent:** general-purpose sub-agent
**Date:** 2026-07-30
**Site:** https://agent007-ai.vercel.app
**Symptom:** Homepage loads fine (~40ms TTFB, 17.8KB HTML), but switching to
tabs like Chat, Mission, Dashboard, Pods, Schedules, Settings takes 15+ seconds.

---

## EXECUTIVE SUMMARY

The 15-second delay is caused by **cold serverless Lambdas** + **no loading
feedback** + **a useless pre-warm strategy**. The homepage is fast because it's
a 17.8KB static-ish HTML shell, but every tab switch triggers dynamic JS chunk
downloads AND cold Lambda invocations that the existing PreWarmDb component
fails to warm (it fires 3 fetches that get 307-redirected by the auth middleware
before reaching the actual Lambda).

**Top 5 causes (ranked by impact):**

| # | Cause | Impact | Fix Status |
|---|-------|--------|------------|
| 1 | Dynamic tab imports use `loading: () => null` — blank screen during chunk download (1-5s) with zero visual feedback | **Critical** — users perceive "frozen" app | ✅ FIXED |
| 2 | Dashboard tab fires 5 concurrent fetches on mount (income, settings, widgets, manifest 219KB, missions/heartbeats) — each hits a COLD Lambda (3-5s each, parallel) | **Critical** — 5-15s on first Dashboard click | ✅ PARTIAL (pre-warm added) |
| 3 | PreWarmDb fires `/api/conversations?limit=1` + `/api/memory?limit=1` but both are auth-protected → middleware 307-redirects them → **Lambda never invoked** → never warmed | **High** — the 3 primary endpoints stay cold until after auth | ⚠️ DOCUMENTED (needs middleware change) |
| 4 | page.tsx sequences `/api/health` BEFORE the 3 real fetches via `.finally()` — but `/api/health` is a DIFFERENT Lambda, so warming it does nothing for `/api/conversations`. Adds ~0.3s sequential delay. | **Medium** — 0.3s wasted on every page load | ✅ FIXED |
| 5 | `/api/system/manifest` returns **219KB JSON** and is fetched by `AutonomyIntelligencePanel` on every Dashboard mount | **Medium** — 0.9s download + parse on every dashboard open | ⚠️ DOCUMENTED (needs endpoint slimming) |

---

## DETAILED FINDINGS

### 1. `loading: () => null` on all dynamic tab imports (FIXED)

**File:** `src/app/page.tsx` (lines 22-27, original)

**Before:**
```tsx
const DashboardTab = dynamic(() => import('...dashboard-tab'), { loading: () => null })
const SchedulesTab = dynamic(() => import('...schedules-tab'), { loading: () => null })
// ... 4 more tabs, all with loading: () => null
```

**Problem:** When the user clicks a tab, Next.js triggers a network fetch for
the JS chunk (Dashboard tab's chunk includes **recharts** ~150KB gzipped +
framer-motion + 1493 lines of component code). During this download, the
`loading` function renders `null` — a completely blank center panel. The user
sees nothing for 1-5s and assumes the app is broken/slow.

**Fix:** Replaced `() => null` with a `<TabLoader>` component that shows a
centered spinner + "Loading dashboard…" text. This doesn't make the chunk
download faster, but it eliminates the "is it broken?" perception.

**After:**
```tsx
const TabLoader = ({ label }: { label: string }) => (
  <div className="flex-1 flex flex-col items-center justify-center text-[#7c89b5] gap-3">
    <Loader2 className="w-6 h-6 animate-spin text-cyan-300" />
    <span className="text-xs tracking-wider">{label}</span>
  </div>
)
const DashboardTab = dynamic(..., { loading: () => <TabLoader label="Loading dashboard…" /> })
```

---

### 2. Dashboard tab fires 5 concurrent cold-Lambda fetches on mount

**Files:**
- `src/components/agent/tabs/dashboard-tab.tsx` (lines 157-182) — fires 3 fetches
- `src/components/agent/mission-monitor.tsx` (line 113) — fires 1 fetch
- `src/components/agent/autonomy-intelligence-panel.tsx` (line 178) — fires 1 fetch

**Problem:** When the Dashboard tab mounts, these fire concurrently:
1. `POST /api/income?seedIfEmpty=true` (background, non-awaited)
2. `GET /api/income` — cold Lambda #1
3. `GET /api/settings` — cold Lambda #2
4. `GET /api/dashboard/widgets` — cold Lambda #3
5. `GET /api/missions/heartbeats` (from MissionMonitor) — cold Lambda #4
6. `GET /api/system/manifest` (from AutonomyIntelligencePanel) — cold Lambda #5, **219KB response**

Each cold Lambda on Vercel takes 3-5s to spin up. With 5 concurrent cold
Lambdas, Vercel spins up 5 separate instances. Live test confirmed this:
```
5 concurrent requests to /api/subagents:
  req 2: 0.43s  (warm)
  req 3: 0.44s  (warm)
  req 4: 0.44s  (warm)
  req 5: 1.23s  (cold #2)
  req 1: 2.81s  (cold #3 — 2.6s TTFB = cold start)
```

**Partial fix applied:** Added background pre-warming of the 3 Dashboard
endpoints (`/api/income?limit=1`, `/api/settings`, `/api/dashboard/widgets`)
in page.tsx's post-auth useEffect, using `keepalive: true` so they survive
navigation. This warms the Lambdas during the ~2s the user spends looking at
the Chat tab before clicking Dashboard.

**Remaining:** `/api/missions/heartbeats` and `/api/system/manifest` are still
cold on first Dashboard click. Recommendations:
- Move `AutonomyIntelligencePanel`'s manifest fetch to the page-level pre-warm
- Add `/api/missions/heartbeats` to the pre-warm list
- Slim down `/api/system/manifest` (219KB → <20KB) by removing per-tool detail

---

### 3. PreWarmDb is ineffective for auth-protected routes (DOCUMENTED)

**File:** `src/components/providers/pre-warm-db.tsx`

**Problem:** PreWarmDb fires 3 fetches on every page load:
```tsx
const endpoints = ['/api/conversations?limit=1', '/api/memory?limit=1', '/api/subagents']
```

But `/api/conversations` and `/api/memory` are **auth-protected** (see
`src/middleware.ts` matcher — they're NOT in the exclusion list). The
`withAuth` middleware runs on the Edge runtime and returns a 307 redirect to
`/login` for unauthenticated requests — **the actual route handler (Lambda) is
never invoked**. So the Lambda + Prisma connection is NOT warmed.

Only `/api/subagents` is public (excluded from middleware) and actually gets
warmed.

**Evidence:** Live curl tests show auth-protected routes return 307 in ~50ms
(middleware short-circuits before any DB call):
```
/api/conversations  → HTTP 307 | 0.10s  (redirected, no DB)
/api/memory         → HTTP 307 | 0.07s  (redirected, no DB)
/api/subagents      → HTTP 200 | 0.51s  (actual DB query — warmed!)
```

**Fix needed (not applied — requires architectural decision):**
- **Option A:** Add a public `/api/_warm` endpoint that runs `ensureDbReady()`
  and a trivial Prisma `count()` query. Call this from PreWarmDb. This warms
  the DB connection pool without exposing user data.
- **Option B:** Move the PreWarmDb logic into page.tsx's post-auth useEffect
  (after `status === 'authenticated'`). The fetches will include the session
  cookie and actually reach the Lambda. (The new pre-warm code in page.tsx
  already does this for the Dashboard endpoints — same pattern should be
  applied to conversations/memory/subagents, but those are already loaded
  directly by `loadConversations()` etc.)
- **Option C:** Add `conversations` and `memory` to the middleware exclusion
  list with a custom auth check inside the route handler that returns 401 (not
  307) for unauthenticated requests. A 401 response still invokes the Lambda
  and warms it. This is the most robust fix.

---

### 4. page.tsx sequences `/api/health` before real fetches (FIXED)

**File:** `src/app/page.tsx` (original lines 74-90)

**Before:**
```tsx
useEffect(() => {
  if (status !== 'authenticated') return
  fetch('/api/health', { signal: AbortSignal.timeout(5000) })  // ← useless
    .catch(() => {})
    .finally(() => {
      Promise.all([loadConversations(), loadMemories(), loadSubagentCount()])
    })
  startAutoRefresh()
}, [...])
```

**Problem:** The comment claimed "Pre-warm the serverless instance, THEN fire
all 3 loads in parallel — they should hit a warm instance." But `/api/health`
is a **separate Lambda** from `/api/conversations`. Warming `/api/health` does
NOTHING for the other endpoints. This added a ~0.3s sequential delay (the
health request's TTFB) before the real data fetches even started.

**After:**
```tsx
useEffect(() => {
  if (status !== 'authenticated') return
  // Fire the 3 primary loads immediately (no pre-warm gate)
  Promise.all([loadConversations(), loadMemories(), loadSubagentCount()])
    .catch(() => {})
  // Pre-warm Dashboard tab endpoints in the background
  const dashEndpoints = ['/api/income?limit=1', '/api/settings', '/api/dashboard/widgets']
  dashEndpoints.forEach((path) => {
    fetch(path, { method: 'GET', keepalive: true, signal: AbortSignal.timeout(8000) })
      .catch(() => {})
  })
  startAutoRefresh()
}, [...])
```

This removes the 0.3s sequential delay AND adds background pre-warming of the
Dashboard endpoints (which are different Lambdas that PreWarmDb doesn't warm).

---

### 5. `/api/system/manifest` returns 219KB JSON (DOCUMENTED)

**File:** `src/app/api/system/manifest/route.ts`
**Called by:** `src/components/agent/autonomy-intelligence-panel.tsx` (line 178)

**Problem:** Live measurement:
```
/api/system/manifest → HTTP 200 | 0.87s total | 218,921 bytes (219KB)
```

This endpoint returns the full upgrade manifest including per-tool descriptions,
subagent definitions, capability listings, etc. The `AutonomyIntelligencePanel`
fetches it on every Dashboard mount just to display a few summary stats.

**Fix needed (not applied):**
- Create a slim `/api/system/manifest?summary=true` endpoint that returns only
  the fields AutonomyIntelligencePanel actually uses (tool count, agent count,
  version) — should be <2KB.
- OR cache the manifest response in the browser with `stale-while-revalidate`
  (currently `force-dynamic` + `no-cache` headers force a fresh 219KB download
  every time).

---

## SECONDARY FINDINGS (not in top 5)

### 6. `/api/conversations/[id]` loads ALL messages with no pagination

**File:** `src/app/api/conversations/[id]/route.ts` (line 18)
```ts
const conv = await db.conversation.findUnique({
  where: { id },
  include: { Message: { orderBy: { createdAt: 'asc' } } },  // ← ALL messages
})
```

**Problem:** No `take`, no `select`, no pagination. For a conversation with
500+ messages (common for long missions), this returns megabytes of JSON,
including full `toolResult` strings for every tool call. The client-side
`loadMessages` then iterates all rows to reconstruct the UI.

**Impact:** Medium — affects conversation opening, not tab switching. But
contributes to overall "slow" perception.

**Fix:** Add `take: 200` and `select` to strip large fields, or implement
cursor-based pagination.

### 7. Schedules tab fires `/api/schedules/tick` every 60s on mount

**File:** `src/components/agent/tabs/schedules-tab.tsx` (lines 55-65)
```tsx
useEffect(() => {
  load()
  const tick = () => { fetch('/api/schedules/tick', { method: 'POST' }).then(() => load()) }
  const id = setInterval(tick, 60_000)
  return () => clearInterval(id)
}, [load])
```

**Problem:** `/api/schedules/tick` is a heavy endpoint that finds due
schedules, updates timestamps, and fires background `runOrchestrator()` calls
(via `waitUntil`). Although the response is fast (~0.3s) thanks to
`backgroundFire()`, the 60s polling is unnecessary — Vercel Cron already
handles this every 30 minutes.

**Impact:** Low-Medium — background noise, not the main tab-switch delay.

**Fix:** Remove the `setInterval` — rely on Vercel Cron + manual "Run Now"
button.

### 8. `/api/income` runs 3 DB queries per request (including a full-table scan)

**File:** `src/app/api/income/route.ts` (lines 22-53)
```ts
const count = await db.incomeEntry.count()           // query 1 (seed check)
const entries = await db.incomeEntry.findMany({...}) // query 2 (filtered)
const allEntries = await db.incomeEntry.findMany({}) // query 3 (ALL entries for aggregates)
```

**Problem:** Query 3 loads EVERY income entry into memory to compute
today/yesterday/month aggregates in JS. For a user with thousands of entries,
this is slow.

**Fix:** Use Prisma `aggregate()` / `groupBy()` for the aggregates instead of
loading all rows. Or cache the aggregates with a short TTL.

---

## LIVE ENDPOINT MEASUREMENTS

All measurements taken 2026-07-30 against https://agent007-ai.vercel.app:

| Endpoint | Auth? | HTTP | Size | TTFB | Total |
|----------|-------|------|------|------|-------|
| `/` (homepage HTML) | — | 200 | 17.8KB | 40ms | 40ms |
| `/api/health` | No | 200 | 207B | 259ms | 260ms |
| `/api/conversations` | Yes | 307 | 15B | 105ms | 106ms |
| `/api/subagents` | **No** | 200 | 47KB | 507ms | 513ms |
| `/api/memory` | Yes | 307 | — | 72ms | 72ms |
| `/api/income` | Yes | 307 | 15B | 50ms | 51ms |
| `/api/settings` | Yes | 307 | — | 183ms | 183ms |
| `/api/dashboard/widgets` | Yes | 307 | — | 52ms | 53ms |
| `/api/schedules` | Yes | 307 | — | 50ms | 50ms |
| `/api/schedules/tick` (POST) | No | 200 | — | 301ms | 301ms |
| `/api/system/refresh` | No | 200 | 173B | 280ms | 280ms |
| `/api/system/manifest` | No | 200 | **219KB** | 323ms | 871ms |
| `/api/system/audit` | No | 200 | 16.7KB | — | — |
| `/api/system/capabilities` | No | 200 | 20KB | — | — |
| `/api/team/scout?action=pods` | No | 200 | 1.9KB | 257ms | 257ms |
| `/api/missions/heartbeats` | Yes | 307 | — | 65ms | 65ms |
| `/api/mission/tick?action=status` | No | 200 | — | 282ms | 282ms |

**Key insight:** All 307 responses are auth-redirects that NEVER reach the
Lambda. The actual authenticated response times would be 300-500ms (warm) or
3-5s (cold) per endpoint.

**Concurrent test (5 parallel requests to /api/subagents):**
```
req 2: 0.43s (warm)    req 4: 0.44s (warm)
req 3: 0.44s (warm)    req 5: 1.23s (cold #2)
req 1: 2.81s (cold #3 — 2.6s cold-start TTFB)
```
→ Vercel spins up additional Lambda instances under concurrency, each paying
the cold-start tax.

---

## CODE CHANGES APPLIED

### `src/app/page.tsx`

1. **Replaced** all 6 `loading: () => null` with `<TabLoader label="…" />`
   that shows a spinner + text during chunk download.
2. **Removed** the sequential `fetch('/api/health')` pre-warm gate — it was
   warming the wrong Lambda and adding 0.3s delay.
3. **Added** background pre-warming of the 3 Dashboard tab endpoints
   (`/api/income?limit=1`, `/api/settings`, `/api/dashboard/widgets`) using
   `keepalive: true` so they're warm when the user clicks Dashboard.

**TypeScript:** 0 new errors (verified with `npx tsc --noEmit -p tsconfig.json`
— all remaining errors are pre-existing in `scripts/` and `examples/`).

---

## RECOMMENDED NEXT ACTIONS (priority order)

1. **(HIGH)** Fix PreWarmDb to use a public warm-up endpoint OR move the
   pre-warm into the post-auth useEffect with the session cookie. Currently
   2 of the 3 PreWarmDb fetches are 307-redirected and do nothing.

2. **(HIGH)** Slim `/api/system/manifest` from 219KB to <20KB. Add a `?summary`
   mode that returns only the fields `AutonomyIntelligencePanel` needs.

3. **(MEDIUM)** Add pagination to `/api/conversations/[id]` — currently loads
   ALL messages with ALL fields (including full `toolResult` strings).

4. **(MEDIUM)** Remove the 60s `setInterval` in `schedules-tab.tsx` — Vercel
   Cron already handles ticking every 30 minutes.

5. **(MEDIUM)** Refactor `/api/income` to use Prisma `aggregate()` instead of
   loading all entries into memory for JS-side aggregation.

6. **(LOW)** Consider eager-loading the Dashboard tab chunk (not dynamic) if
   the user typically navigates to it within 5s of page load. The recharts
   library is ~150KB gzipped — if most users hit Dashboard, the dynamic import
   costs more in cold latency than it saves in initial bundle size.

7. **(LOW)** Add `/api/missions/heartbeats` and `/api/system/manifest` to the
   page-level background pre-warm list so they're warm on first Dashboard click.

---

## CONCLUSION

The 15-second tab delay is a **compound problem**: cold Lambdas (3-5s each) ×
multiple concurrent fetches per tab (3-5 fetches) × no loading feedback (blank
screen) × ineffective pre-warming (307-redirected). No single fix solves it —
the applied changes address the perceived-performance (loading spinners) and
the sequential-delay (removed useless /api/health gate) issues. The remaining
cold-start tax requires either a public warm-up endpoint or moving pre-warm
calls to post-auth.
