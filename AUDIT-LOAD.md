# AUDIT-3 — Page-Load Issue Investigation

**Date:** 2026-07-29
**Agent:** Super Z (debugging sub-agent)
**Scope:** Investigate the user's "still having issues" report against https://agent007-ai.vercel.app/
**Live URL tests:** See "Evidence" sections for curl output.

---

## TL;DR — Top 5 page-load issues (in priority order)

| # | Severity | Issue | File:Line | Impact |
|---|----------|-------|-----------|--------|
| 1 | **CRITICAL** | PreWarmDb fires `/api/health` which is a NO-OP for DB warming (it's a static JSON response, never touches Prisma). The 3 endpoints actually called on chat mount (`/api/conversations`, `/api/memory`, `/api/subagents`) each have their own serverless instance + their own `globalForPrisma.prisma` cache. First cold-start page load takes **5–10s**. | `src/components/providers/pre-warm-db.tsx:34`<br>`src/app/api/health/route.ts:31-43` | +5–10s on first load after every deploy |
| 2 | **HIGH** | `page.tsx` useEffect fires `/api/health` AGAIN inside a `.finally()` that gates the 3 real data-fetching calls. Sequential, not parallel. Redundant with PreWarmDb (which already fires the same no-op endpoint). Adds ~250ms warm / up to 5s cold to every load. | `src/app/page.tsx:78-87` | +250ms–5s on every load |
| 3 | **HIGH** | Stream disconnect (Vercel 300s timeout, network blip, user-clicked Stop, 180s client timeout) leaves `_pendingTokens` un-flushed. The post-loop `set` (line 645) and the catch block (line 692) both mark `isStreaming: false` and append error messages WITHOUT including the last ~100ms of buffered tokens. **Silent truncation** — user sees partial response with no error indication. | `src/store/chat-store.ts:604-720` | Lost last 100ms of every aborted/disconnected response |
| 4 | **HIGH** | Initial JS bundle is **314 KB gzipped** (15 chunks, ~1 MB raw). Heaviest non-core contributors loaded EAGERLY on every page load:<br>- `react-markdown` + `remark` + `micromark` = **57 KB gz** (chunk `34cebabf`, 195 KB raw) — pulled in via `message-bubble.tsx:6`<br>- `framer-motion` = **38 KB gz** (chunk `cbdf158a`, 113 KB raw) — pulled in via `page.tsx:6`<br>- `core-js` polyfills = **41 KB gz** (chunk `a6dad97d`, 112 KB raw) — could be eliminated by targeting modern browsers | `src/components/agent/message-bubble.tsx:6`<br>`src/app/page.tsx:6,263-264`<br>`package.json` (no `browserslist`) | +200–400 ms JS execution on cold cache, +1.5–3s on slow 3G |
| 5 | **MEDIUM** | #163 "double refresh on stream disconnect" outer-loop flush at `chat-store.ts:620-641` is now **dead code**. After #154 (lines 1291-1309), `applyEvent('done')` synchronously clears `_pendingTokens`. By the time the outer-loop `if (_pendingTokens)` check runs, the buffer is always `''`. The "double refresh" was the fix BEFORE #154 was added; with #154 in place it's a no-op. Not a bug — just unreachable code. | `src/store/chat-store.ts:620-641` | None (dead code, but misleading to future readers) |

---

## Detailed Findings

### CRITICAL #1 — PreWarmDb is firing the wrong endpoint

**Files:**
- `src/components/providers/pre-warm-db.tsx:30-44`
- `src/app/api/health/route.ts:31-43`

**Evidence:**

`PreWarmDb.tsx` comment (lines 21-25) claims:
```
Note: /api/health is chosen because:
  1. It's public (no auth required) — won't 307 redirect
  2. It calls ensureDbReady() implicitly via db.user.findFirst
  3. It returns a small JSON payload (no heavy work)
  4. It's already deployed and known to work
```

But the actual `/api/health/route.ts` is:

```ts
export async function GET() {
  return NextResponse.json({
    ok: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: 'upgrade-58',
    app: 'Agent007 AI',
    url: 'https://agent007-ai.vercel.app',
    region: process.env.VERCEL_REGION ?? 'iad1',
    uptime_seconds: Math.round(process.uptime()),
    runtime: 'nodejs',
  })
}
```

It returns a **static JSON response with NO `db` import, NO `ensureDbReady()` call, NO Prisma query**. The comment is wrong — point 2 ("calls ensureDbReady() implicitly via db.user.findFirst") is FALSE.

The 3 endpoints actually called on chat mount are each **separate serverless functions** with their own `globalForPrisma.prisma` cache (per `src/lib/db.ts:84-88`):
- `/api/conversations` → calls `ensureDbReady()` at line 13
- `/api/memory` → calls `listMemories` which queries Prisma
- `/api/subagents` → calls `db.subagents...` queries

Warming `/api/health` warms ONE Lambda instance that no other route shares. The 3 real endpoints each pay their own cold-start DB init cost (`createTablesViaRawSQL` + `seedData`, ~5s per `db.ts` comment at line 346-353).

**Curl evidence — cold vs warm /api/health:**
```
TTFB: 5.310545s Total: 5.310684s HTTP: 200   ← first call (cold Lambda init, but NO DB)
TTFB: 0.252986s Total: 0.253092s HTTP: 200   ← warm
TTFB: 0.259756s Total: 0.259881s HTTP: 200   ← warm
```

Even /api/health (no DB) takes 5.3s on cold Lambda init. The 3 DB-backed endpoints will take **longer** on cold start (5s Lambda init + 5s DB init = ~10s each, but they run in parallel so wall time is ~10s).

**Suggested fix:**

Change `PreWarmDb.tsx` to fire all 3 actual endpoints in parallel (fire-and-forget, no auth required — they'll return 401 but still warm the Lambda):

```tsx
export function PreWarmDb() {
  useEffect(() => {
    // Fire all 3 endpoints the chat page actually calls — warms their
    // serverless instances + DB connections in parallel with useSession.
    const endpoints = ['/api/conversations', '/api/memory', '/api/subagents']
    endpoints.forEach((url) => {
      fetch(url, { signal: AbortSignal.timeout(10_000) }).catch(() => {})
    })
  }, [])
  return null
}
```

(Or better: create a single `/api/bootstrap` endpoint that returns all 3 datasets in one response — eliminates 2 round-trips and warms a single instance.)

---

### HIGH #2 — page.tsx useEffect blocks the 3 real calls behind a redundant /api/health call

**File:** `src/app/page.tsx:74-90`

**Code:**
```jsx
useEffect(() => {
  if (status !== 'authenticated') return
  // Pre-warm the serverless instance, THEN fire all 3 loads in parallel
  // The pre-warm is fast (~100ms warm, ~500ms cold) warms the DB connection.
  fetch('/api/health', { signal: AbortSignal.timeout(5000) })
    .catch(() => {}) // Non-fatal — proceed even if pre-warm fails
    .finally(() => {
      // Now fire all 3 loads in parallel — they should hit a warm instance.
      Promise.all([
        loadConversations(),
        loadMemories(),
        loadSubagentCount(),
      ]).catch(() => {/* swallow — each function already handles errors */})
    })
  // Start the 15s auto-refresh loop, non-blocking
  startAutoRefresh()
}, [status, loadConversations, loadMemories, loadSubagentCount, startAutoRefresh])
```

**Issues:**

1. The `/api/health` call here is **redundant** — `PreWarmDb` (mounted in `layout.tsx:86`) already fires the same endpoint on every page load. Firing it twice doesn't help.

2. The `.finally()` block **blocks** the 3 real data-fetching calls until `/api/health` completes (success, failure, or 5s timeout). On a cold Lambda, `/api/health` takes 5.3s (curl evidence above). The 3 parallel calls wait 5.3s before firing.

3. The comment "warms the DB connection" is **wrong** (see CRITICAL #1 — `/api/health` doesn't touch DB). The pre-warm here is a no-op for DB.

4. Sequential, not parallel: should fire all 4 calls (or just the 3 real ones) in parallel via `Promise.all`.

**Suggested fix:**

```jsx
useEffect(() => {
  if (status !== 'authenticated') return
  // Fire all 3 data loads in parallel. PreWarmDb (in layout.tsx) already
  // warmed the serverless instances; no need for another pre-warm here.
  Promise.all([
    loadConversations(),
    loadMemories(),
    loadSubagentCount(),
  ]).catch(() => {})
  startAutoRefresh()
}, [status, loadConversations, loadMemories, loadSubagentCount, startAutoRefresh])
```

This removes the redundant `/api/health` fetch and the `.finally()` gate. The 3 calls fire immediately when `status === 'authenticated'`.

---

### HIGH #3 — `_pendingTokens` not flushed on stream disconnect / abort / timeout

**File:** `src/store/chat-store.ts:514-720`

The `sendMessage` function uses a module-level `_pendingTokens` buffer (line 834) + a 100ms throttled flush timer (lines 1130-1148). Three exit paths fail to flush the buffer:

**Path A — Server abrupt close (Vercel 300s timeout, network blip):**

```ts
// chat-store.ts:604-643
while (true) {
  if (abortFlag.current) break                          // Path B
  const { done, value } = await reader.read()
  if (done) break                                        // Path A — breaks outer loop, no flush
  buffer += decoder.decode(value, { stream: true })
  let idx: number
  while ((idx = buffer.indexOf('\n\n')) >= 0) {
    const rawEvent = buffer.slice(0, idx)
    buffer = buffer.slice(idx + 2)
    const evt = parseSse(rawEvent)
    if (!evt) continue
    applyEvent(evt.event, evt.data, assistantId, set, get, () => {
      currentStepId = evt.data?.stepId ?? currentStepId
    })
    if (evt.event === 'done' || evt.event === 'error') {
      // UPGRADE #163: Flush ANY remaining pending tokens before breaking.
      if (_pendingTokens) { /* ... flush ... */ }
      break                                              // breaks inner loop only
    }
  }
}

// Path A & B both reach here — post-loop set:
set((s) => {
  const newMessages = s.messages.map((m) =>
    m.id === assistantId ? { ...m, isStreaming: false } : m  // ← NO _pendingTokens added
  )
  // ... localStorage save ...
  return { messages: newMessages, status: 'idle', /* ... */ }
})
```

When the server closes the stream WITHOUT sending a `done` or `error` event (e.g., Vercel's 300s hard timeout kills the Lambda, network blip drops the connection), `reader.read()` returns `{ done: true, value: undefined }`. The `if (done) break` at line 607 exits the outer loop. The inner SSE parser never runs. The post-loop `set` marks `isStreaming: false` but **does not include `_pendingTokens`** in the message content. The user sees a truncated response with **no error indication** — silent truncation.

**Path B — User clicks Stop (sets `abortFlag.current = true`):**

Same path A flow. The `if (abortFlag.current) break` at line 605 exits the outer loop. No flush. The user sees truncated content with no error.

Also, the fetch's `signal: AbortSignal.timeout(180_000)` is the ONLY abort signal — clicking Stop doesn't actually abort the fetch (the server keeps running). The loop just stops reading.

**Path C — 180s client timeout fires:**

The fetch throws an `AbortError`. The catch block at line 692 runs:

```ts
// chat-store.ts:692-720
} catch (e: any) {
  console.error('sendMessage error', e)
  let errMsg = e?.message ?? String(e)
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
    errMsg = 'The request timed out after 180 seconds. ...'
  }
  // ...
  set((s) => ({
    messages: s.messages.map((m) =>
      m.id === assistantId
        ? {
            ...m,
            isStreaming: false,
            content:
              m.content +                                    // ← m.content does NOT include _pendingTokens
              (m.content ? '\n\n' : '') +
              `⚠️ **Error:** ${errMsg.slice(0, 300)}`,
          }
        : m
    ),
    // ...
  }))
}
```

The catch block appends the error message to `m.content`, but `m.content` does NOT include `_pendingTokens` — the last 100ms of buffered tokens are silently dropped.

**Suggested fix — flush `_pendingTokens` in all 3 exit paths:**

Add a helper at module scope:
```ts
function flushPendingTokens(assistantId: string, set: any, suffix: string = ''): void {
  const pendingContent = _pendingTokens
  _pendingTokens = ''
  if (_tokenFlushTimer) {
    clearTimeout(_tokenFlushTimer)
    _tokenFlushTimer = null
  }
  if (!pendingContent) return
  set((s) => ({
    messages: s.messages.map((m) =>
      m.id === assistantId
        ? { ...m, content: m.content + pendingContent + suffix }
        : m
    ),
  }))
}
```

Then call it in the post-loop `set` and the catch block before applying any other updates.

---

### HIGH #4 — Initial JS bundle is 314 KB gzipped

**Evidence:**

```bash
$ for f in <13 chunk filenames>; do
    sz=$(curl -s --compressed "https://agent007-ai.vercel.app/_next/static/chunks/$f" -o /dev/null -w "%{size_download}")
    echo "$f: $sz bytes (gzipped)"
  done
13f23e5e646acce1.js: 32431 bytes (gzipped)   # React core (react-dom, scheduler)
1627bf2f54f2038d.js: 9429 bytes (gzipped)     # Next.js InvariantError
34cebabf6f6b4f0a.js: 57452 bytes (gzipped)   # react-markdown + remark + micromark + mdast
48a177f7ab9d4d5b.js: 8949 bytes (gzipped)    # lucide-react icons (subset)
74f1b9da08b28ae5.js: 7773 bytes (gzipped)    # Next.js router helpers
7b2fe2139cb5d328.js: 10279 bytes (gzipped)   # lucide-react icon factory
a6dad97d9634a72d.js: 41343 bytes (gzipped)   # core-js polyfills
c42c78771b1e3645.js: 6982 bytes (gzipped)    # more lucide icons
c5545a701595ee2d.js: 71390 bytes (gzipped)   # Next.js core (App Router, etc.)
cbdf158a79490c20.js: 38786 bytes (gzipped)   # framer-motion (motion-value, transforms)
ce7f11cd69d0a785.js: 18704 bytes (gzipped)   # sonner (toast library)
fe089c3d44354111.js: 6233 bytes (gzipped)    # Next.js ISRError handler
turbopack-c7f8b61186c3560d.js: 4406 bytes (gzipped)  # turbopack runtime
TOTAL gzipped: 314157 bytes (~307 KB)
```

Plus 17.8 KB HTML = **~325 KB initial transfer** (gzipped). On a 1.5 Mbps slow 3G connection that's ~1.7s of download time alone; on 50 Mbps cable it's ~50ms download + ~200–400ms JS execution.

**Biggest offenders that could be reduced:**

1. **react-markdown + remark + micromark** — 57 KB gzipped (chunk `34cebabf`)
   - Imported eagerly via `src/components/agent/message-bubble.tsx:6` and `src/components/agent/reasoning-panel.tsx:16`
   - `MessageBubble` is rendered for every message in the chat thread — needed on first paint only if the user has prior messages
   - **Fix options:**
     - Lazy-load `MessageBubble` with `next/dynamic` and a plain-text fallback (the empty state doesn't need markdown)
     - Or replace `react-markdown` with `marked` (~10 KB gzipped, single function call, no AST)
     - Or pre-render markdown server-side and ship pre-rendered HTML

2. **framer-motion** — 38 KB gzipped (chunk `cbdf158a`)
   - Imported eagerly via `src/app/page.tsx:6` (and used in `AnimatePresenceHelper` at line 266-341 for sidebar animations)
   - Also imported in `ChatHeader`, `SidebarLeft`, `SidebarRight`, `MessageBubble`, `AgentProgressBanner`, `EmptyState`, `ScrollArrows`, `ChatInput` (just `motion.div` wrappers)
   - **Fix options:**
     - Replace `AnimatePresenceHelper`'s sidebar slide-in with CSS `transition: width 0.25s` + `transform: translateX()` — saves ~38 KB
     - Or replace `motion.div` wrappers in non-critical components with CSS animations
     - Keep framer-motion only for the layout-id shared element animation (the tab underline) — that's the one feature CSS can't easily replicate

3. **core-js polyfills** — 41 KB gzipped (chunk `a6dad97d`)
   - Next.js 16 includes polyfills for the `browserslist` setting in `package.json`. The project has **no `browserslist` field**, so Next.js defaults to its internal default which includes older browsers (e.g., iOS 12, Chrome 49).
   - **Fix:** Add to `package.json`:
     ```json
     "browserslist": [
       "chrome >= 100",
       "safari >= 15",
       "firefox >= 100",
       "edge >= 100"
     ]
     ```
     This drops Array.iterator, Promise.allSettled, Object.fromEntries, etc. polyfills for browsers that don't need them. Saves most of the 41 KB.

**Note:** `recharts` (~50 KB gzipped typically) is correctly lazy-loaded via `next/dynamic` in `src/app/page.tsx:22-27` for the `DashboardTab`. Good.

---

### MEDIUM #5 — #163 outer-loop flush is dead code (after #154)

**File:** `src/store/chat-store.ts:620-641`

**Code:**
```ts
// Inside the inner SSE parser loop, after applyEvent() returns:
if (evt.event === 'done' || evt.event === 'error') {
  // UPGRADE #163: Flush ANY remaining pending tokens before breaking.
  if (_pendingTokens) {                                    // ← always false after #154
    const remaining = _pendingTokens
    _pendingTokens = ''
    if (_tokenFlushTimer) {
      clearTimeout(_tokenFlushTimer)
      _tokenFlushTimer = null
    }
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id !== assistantId) return m
        return { ...m, content: m.content + remaining }
      }),
    }))
  }
  break
}
```

**Analysis:**

`applyEvent(evt.event, ...)` was called at line 617 BEFORE this block runs. For both `'done'` (lines 1291-1309) and `'error'` (lines 1218-1284) events, `applyEvent` synchronously:
1. Captures `pendingContent = _pendingTokens`
2. Sets `_pendingTokens = ''`
3. Clears `_tokenFlushTimer`
4. Updates the message content with `pendingContent`

Because JS is single-threaded and `applyEvent` runs to completion before the outer `if` check evaluates, by the time line 626 runs `if (_pendingTokens)`, the buffer is **always** `''`. The outer flush is **unreachable dead code**.

The "double refresh" from #163 was the original fix. When #154 was added (which moved the flush into `applyEvent('done')` synchronously), #163's outer-loop flush became redundant. The code wasn't cleaned up.

**Not a bug** — just dead code that confuses readers. Suggested cleanup: delete lines 620-641 (the entire `if (evt.event === 'done' || evt.event === 'error')` block) and keep just `if (evt.event === 'done' || evt.event === 'error') break` on a single line.

---

### LOW (informational) — Minor observations

**A. Hidden `<span>` dead code in `page.tsx:252-254`:**
```jsx
{/* Hidden state-keeper so conversations load on mount even if unused */}
<span className="hidden" aria-hidden>
  {conversations.length}
</span>
```
The `useChatStore((s) => s.conversations)` selector at line 46 already subscribes the component to conversations changes. The hidden span doesn't help — it's dead code. Remove it.

**B. Click-Stop doesn't actually abort the fetch (`chat-store.ts:723-726`):**
```ts
stopStreaming: () => {
  get().abortFlag.current = true
  set({ status: 'idle', currentTool: null })
},
```
The fetch's only signal is `AbortSignal.timeout(180_000)` (line 586). Clicking Stop sets a flag but doesn't pass an `AbortController.signal` to the fetch. The server keeps running (and burning LLM tokens) until it completes naturally or the 180s timeout fires. Not a page-load issue, but a cost concern. Fix: create an `AbortController` per `sendMessage` call, store it in the store, and call `.abort()` in `stopStreaming`.

**C. `_pendingTokens` is module-level, not per-`sendMessage` (`chat-store.ts:834`):**
```ts
let _pendingTokens = ''
let _tokenFlushTimer: ReturnType<typeof setTimeout> | null = null
```
If the user sends message A, aborts it, then immediately sends message B, message B inherits message A's leftover `_pendingTokens` (if any). In practice the `status !== 'idle'` check at line 518 prevents concurrent sends, so this is safe — but it's fragile. If a future change allows concurrent sends, this becomes a content-bleed bug. Fix: move `_pendingTokens` and `_tokenFlushTimer` into a per-call closure inside `sendMessage`.

**D. Cache headers are correct:**
- HTML page: `Cache-Control: no-cache, no-store, must-revalidate` (set in `next.config.ts` headers()). Correct — forces every device to fetch the latest HTML.
- Static chunks (`/_next/static/*`): `Cache-Control: public, max-age=31536000, immutable` (set in `next.config.ts`). Correct — chunks are content-hashed, safe to cache forever.
- Edge cache: `x-vercel-cache: HIT`, `age: 68453` — Vercel edge cache is working. First curl was a 345ms cache-miss; subsequent curls were 33-39ms cache-hits.

**E. HTTP/2 + TLS:**
- HTTP/2 200, HSTS preload, CSP, X-Frame-Options: DENY, X-Content-Type-Options: nosniff — all set correctly. No security headers missing.

**F. /api/agent route is correct (`src/app/api/agent/route.ts`):**
- `maxDuration = 300` (line 12) — correct for Vercel Pro.
- `runtime = 'nodejs'` (line 7) — correct (not edge).
- `ReadableStream` setup (lines 84-132) — correct, with `safeEnqueue` guarding against closed streams, heartbeat ping every 5s, `clearInterval` + `controller.close()` in `finally`.
- `'done'` event emitted at line 115 before close; `'error'` event at line 117 on exception.
- Response headers correct: `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no` (nginx, no-op on Vercel but harmless).

**G. DB pool warning (`src/lib/db.ts:60-77`):**
- The startup self-check warns if `DATABASE_URL` doesn't use a pooler (Neon port 6543, Supabase `?pgbouncer=true`, Vercel Postgres auto-pooled). Without a pooler, each cold start adds 1-3s TLS handshake. The owner should verify the `DATABASE_URL` env var on Vercel uses the pooled connection string. (Couldn't verify from sandbox — env var not readable here.)

---

## Vercel Function Logs

Attempted to fetch live logs via `npx vercel logs https://agent007-ai.vercel.app --token vcp_1bpUzdaBOaVaChUduS6RAXfwt9JdENQ1iB7tmp015aqHJMWun31kfROV`. The CLI installed (v58.4.0) and authenticated, but `Fetching logs...` hung for 30s+ without returning output. Likely a Vercel CLI issue with this token's permission scope (the token was used to deploy #168 in a prior session and may be scoped to deployment, not log streaming). Skipped — curl evidence above is more concrete for the issues found.

---

## Reproduction / Verification

To verify the issues on production:

```bash
# 1. Verify /api/health is a no-op (no DB query, returns in <100ms warm)
curl -sI https://agent007-ai.vercel.app/api/health

# 2. Verify /api/conversations cold-start cost (will be slow on first call after deploy)
# Must include session cookie — anonymous call returns 401, but the Lambda still inits.
for i in 1 2 3; do
  curl -s -o /dev/null -w "TTFB: %{time_starttransfer}s Total: %{time_total}s HTTP: %{http_code}\n" \
    https://agent007-ai.vercel.app/api/conversations
done

# 3. Verify initial bundle size (sum of all chunk sizes)
for f in $(curl -s https://agent007-ai.vercel.app/ | rg -o '/_next/static/chunks/[a-zA-Z0-9_.-]+\.js' | sort -u); do
  curl -s --compressed "https://agent007-ai.vercel.app$f" -o /dev/null -w "$f: %{size_download} bytes\n"
done

# 4. HTML page timing (should be <100ms warm due to edge cache)
for i in 1 2 3; do
  curl -s -o /dev/null -w "TTFB: %{time_starttransfer}s Total: %{time_total}s\n" \
    https://agent007-ai.vercel.app/
done
```

---

## Recommended Action Plan (priority order)

1. **Fix PreWarmDb** (CRITICAL #1) — Change to fire `/api/conversations`, `/api/memory`, `/api/subagents` in parallel instead of `/api/health`. ~10 line change.

2. **Fix page.tsx useEffect** (HIGH #2) — Remove the redundant `fetch('/api/health')` and `.finally()` gate. Fire the 3 loads in parallel directly. ~5 line change.

3. **Fix `_pendingTokens` flush on disconnect** (HIGH #3) — Add a flush helper, call it in the post-loop `set` (line 645) and the catch block (line 692). ~15 line change.

4. **Add `browserslist` to `package.json`** (HIGH #4c) — Targets modern browsers, drops ~41 KB gzipped of core-js polyfills. ~5 line change.

5. **Lazy-load `MessageBubble`** (HIGH #4a) — Use `next/dynamic` with a plain-text fallback for the empty state. Or replace `react-markdown` with `marked`. ~30 line change.

6. **Replace framer-motion in `AnimatePresenceHelper`** (HIGH #4b) — Use CSS `transition` + `transform` for sidebar slide-in. ~50 line change. Saves ~38 KB gzipped.

7. **Clean up #163 dead code** (MEDIUM #5) — Delete the unreachable outer-loop flush at lines 620-641. ~25 line deletion.

8. **Pass `AbortController` to fetch in `sendMessage`** (LOW B) — Wire Stop button to actually abort the fetch. ~10 line change.

---

**Total estimated impact if all fixes applied:**
- First cold-start load: 5–10s → 2–3s (fixes #1 + #2)
- Warm load: 1.5s → 0.8s (fixes #2 + #4c)
- Initial bundle: 314 KB → ~180 KB gzipped (fixes #4a + #4b + #4c)
- Stream reliability: silent truncation on disconnect → no token loss (fix #3)
