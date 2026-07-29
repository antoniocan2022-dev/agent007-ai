# Deep Audit Report — Agent007 AI — 48-Hour Window

**Audit Date:** 2026-07-29 UTC
**Auditor:** Super Z (Task IDs: AUDIT-1, AUDIT-2, AUDIT-3, AUDIT-DEPLOY)
**Scope:** All changes between 2026-07-27T19:00 and 2026-07-29T19:00 UTC
**Production URL:** https://agent007-ai.vercel.app
**Latest deploy:** `dpl_<fresh> at 2026-07-29T20:00 UTC` from commit `37424627` (HEAD)

---

## EXECUTIVE SUMMARY

### Good News

1. **Fix #168 IS NOW LIVE on production** — verified at 2026-07-29T20:00 UTC
   - `https://agent007-ai.vercel.app/api/system/diagnose-llm` now returns `provider: "groq"` (was `"openai-fallback"`)
   - Groq is now tried first (115ms response time on health check)
   - Falls back to OpenAI (1.2s) → z.ai (1.9s) → Mistral (last resort)

2. **Provider health on production:**
   - ✅ Groq (115ms) — fastest
   - ✅ OpenAI (1203ms)
   - ✅ Z.ai (1880ms)
   - ❌ Mistral (401 Unauthorized)
   - ❌ OpenRouter (404)
   - ❌ Cerebras (404)
   - ❌ Gemini (429 quota exceeded)

3. **9 of the 16 recent upgrades are fully working.**

### Bad News — 5 CRITICAL Issues Found

| # | Severity | Issue |
|---|----------|-------|
| C1 | CRITICAL | Fix #168 was deployed to WRONG Vercel project for ~24 hours (now fixed) |
| C2 | CRITICAL | 3-tier hierarchy (CEO → Leader → Specialist) is broken — `Parsed.dispatch` doesn't exist |
| C3 | CRITICAL | `tool_boundary_audit` audits the wrong list of tools (UPGRADE #167 Step 5 broken) |
| C4 | CRITICAL | Self-learning score never accumulates (UPGRADE #167 Step 3 broken) |
| C5 | CRITICAL | 5 of 7 "fake intelligence" tools still return hardcoded Math.random data (UPGRADE #166 incomplete) |

### Plus 3 HIGH Issues

| # | Severity | Issue |
|---|----------|-------|
| H1 | HIGH | `process.env.LLM_PROVIDER_ORDER` mutation never restored on throw (multi-provider-comparison.ts:49-58) |
| H2 | HIGH | Client timeout 180s < server maxDuration 300s — long missions aborted on client side |
| H3 | HIGH | PreWarmDb fires `/api/health` which is a NO-OP for DB warming — adds 5-10s on cold starts |

---

## CRITICAL ISSUE #1 — Fix #168 Was Deployed to WRONG Project (FIXED)

### What Happened

- Yesterday (2026-07-28T~23:50 UTC), I committed fix #168 (`0148a33`) and ran `npx vercel --prod`.
- The CLI reported `✓ Aliased https://agent007-ai.vercel.app` — but actually created a NEW Vercel project named `my-project` (ID `prj_l71eVO40oDRMTmGI0Sj0WMakdaRU`).
- The `.vercel/project.json` link was silently rewritten to point at the rogue project.
- Production `agent007-ai.vercel.app` kept serving the OLD code without fix #168.
- User reported "agent doesn't recognize the new order in providers" — correctly! The deployed code didn't have the sort.

### Root Cause

The `npx vercel --prod` command, when run in certain conditions (missing/stale auth, missing project link), auto-creates a new project named after the directory (`my-project`). This has happened before — the user mentioned it in the prior conversation summary ("删除了 my-project（Vercel 自动创建）— 使用 scripts/lock-project.sh 防止复发").

### What I Fixed Today

1. Re-linked: `npx vercel link --project agent007-ai --token ...`
2. Re-deployed: `npx vercel --prod` — this time correctly aliased to `https://agent007-ai.vercel.app`
3. Deleted the rogue `my-project` project (DELETE /v9/projects/prj_l71e...)
4. Verified production diagnose returns `provider: "groq"` (was `"openai-fallback"`)
5. Created `scripts/post-deploy-verify.sh` to catch this in future
6. Re-ran `scripts/lock-project.sh` to enforce the correct `.vercel/project.json`

### Prevention

Run this BEFORE every future deploy:
```bash
bash /home/z/my-project/scripts/lock-project.sh
VERCEL_TOKEN=<your_token> bash /home/z/my-project/scripts/post-deploy-verify.sh
```

---

## CRITICAL ISSUE #2 — 3-Tier Hierarchy Is Broken (UPGRADE #165 Gap #1)

### File / Lines
`src/lib/subagents.ts:1583, 1584, 1585`

### What's Wrong

The 3-tier hierarchy (CEO → Leader → Specialist) requires `parsed.dispatch` to be populated so a Leader can delegate to a Specialist. The agent's code path is:

1. Leader's LLM response is parsed by `parseAssistant()` (imported from `agent.ts:1090-1096`)
2. `parseAssistant()` returns a `Parsed` object — **but `Parsed` does NOT include a `dispatch` field**
3. `subagents.ts:1583-1585` reads `parsed.dispatch.agent` and `parsed.dispatch.task` → always `undefined`
4. The recursive delegation block (subagents.ts:1583-1640) **never executes**

### Impact

Specialists are NEVER invoked by Leaders. The entire 3-tier hierarchy collapses to 2 tiers (CEO → Leader). Specialists (the most expensive intelligence layer) are dead weight.

### Evidence

```
src/lib/subagents.ts:1583: error TS2339: Property 'dispatch' does not exist on type 'Parsed'.
src/lib/subagents.ts:1584: error TS2339: Property 'dispatch' does not exist on type 'Parsed'.
src/lib/subagents.ts:1585: error TS2339: Property 'dispatch' does not exist on type 'Parsed'.
```

Three TypeScript errors blocking the build (workarounds exist via `// @ts-ignore` but the logic is dead).

### Suggested Fix

Either:
- **Option A:** Add `dispatch?: { agentId: string; task: string }` to the `Parsed` interface in `agent.ts`, and populate it in `parseAssistant()` (mirror the logic from `parseOrchestrator()` at orchestrator.ts:133).
- **Option B:** Import `parseOrchestrator` into `subagents.ts` and use it instead of `parseAssistant()`.

**Recommended: Option B** — single source of truth, no schema drift.

---

## CRITICAL ISSUE #3 — `tool_boundary_audit` Audits Wrong List (UPGRADE #167 Step 5)

### File / Lines
`src/lib/orchestrator.ts:1326-1346`

### What's Wrong

UPGRADE #167 Step 5 added `tool_boundary_audit` to verify that subagents only call their `allowedTools`. The audit is supposed to compare the SUBAGENT's tool calls against the SUBAGENT's `allowedTools` whitelist.

But the audit reads `steps.filter(...)` from the **orchestrator's** step array (the SUPER-AGENT's steps), not the subagent's. The orchestrator calls `runSubagent()` which returns `{ answer, steps }` — but only `result.answer` is consumed (orchestrator.ts:1276); `result.steps` is ignored.

### Impact

The audit compares super-agent tool calls against subagent `allowedTools` — false positives when the super-agent uses a tool that the subagent isn't allowed to use, AND missed real violations when the subagent uses a forbidden tool.

### Suggested Fix

```typescript
// Replace this (orchestrator.ts:1326):
const ToolsUsedInThisDispatch = steps.filter(s => s.toolName && s.finishedAt).map(s => s.toolName)

// With this:
const subagentSteps = result.steps?.filter(s => s.toolName && s.finishedAt) ?? []
const ToolsUsedInThisDispatch = subagentSteps.map(s => s.toolName)
```

---

## CRITICAL ISSUE #4 — Self-Learning Score Never Accumulates (UPGRADE #167 Step 3)

### File / Lines
`src/lib/subagents.ts:1854-1881`

### What's Wrong

The self-learning flow is:
1. Line 1859: `storePersistentMemory(key, value, 'self_learning', 75|25)` — stores with score 75 (success) or 25 (failure)
2. Line 1879: `updateMemoryScore(key, succeeded)` — moves score ±10

But `storePersistentMemory` (`persistent-memory.ts:76-81`) **overwrites** the existing entry, not merges. So:
- Task succeeds first time → score 75
- `updateMemoryScore` → 75+10 = 85
- Task succeeds again → `storePersistentMemory` resets to 75 → `updateMemoryScore` → 85

The score oscillates between 75 and 85 forever. The comment at line 1869 claims "task succeeded 5 times has score ~95" — **false**.

### Impact

The 90-day learning decay was supposed to let the agent learn which tools/approaches work best. Instead it always thinks every successful task is equally novel.

### Suggested Fix

Skip `storePersistentMemory` if key already exists; only call `updateMemoryScore`. Or pass the prior score through and add to it instead of overwriting.

---

## CRITICAL ISSUE #5 — 5 of 7 "Fake Tools" Still Return Hardcoded Data (UPGRADE #166)

### File / Lines
`src/lib/real-intelligence-tools.ts:6-18` (header) + scattered implementations in other tool files

### What's Wrong

UPGRADE #166's header comment claims "7 fake tools replaced with real implementations." Reality (verified):
- ✅ `self_improving_strategy` — replaced (in `real-intelligence-tools.ts`)
- ✅ `decision_matrix` — replaced
- ❌ `self_optimization_engine` — STILL returns hardcoded "+34% decision quality"
- ❌ `feedback_optimization_loop` — STILL returns hardcoded "47 learnings"
- ❌ `autonomous_decision_maker` — STILL returns hardcoded "+78% conversion"
- ❌ `efficiency_optimizer` — STILL returns hardcoded "Confidence: 0.87"
- ❌ `tool_usage_analyzer` — STILL returns hardcoded "$890/mo projected"

Locations:
- `intelligence-tools-v3.ts:98`
- `performance-enhancement-tools.ts:234, 730`
- `performance-booster-tools.ts:201, 209`

### Impact

Agent continues to hallucinate metrics to users. They look real (formatted nicely) but are Math.random() underneath.

### Suggested Fix

Either:
- **Option A:** Implement real versions in `real-intelligence-tools.ts` and wire them up to override the fake ones in `TOOL_REGISTRY`
- **Option B:** Delete the fake tool entries from `TOOL_REGISTRY` entirely so the agent can't call them
- **Option C:** Update the misleading header comment to match reality (claim only 2/7 replaced)

---

## HIGH ISSUE #1 — `LLM_PROVIDER_ORDER` Env Mutation Not Restored on Throw

### File / Lines
`src/lib/multi-provider-comparison.ts:49-58`

### What's Wrong

The function mutates `process.env.LLM_PROVIDER_ORDER = provider` at line 50, and the restore (`process.env.LLM_PROVIDER_ORDER = original`) is at line 58 — INSIDE the try block, not finally. If `callLlmWithRetry` throws (rate limit, network, auth), the restore never runs.

### Impact

The mutated env var stays for the lifetime of the Vercel warm Lambda instance. ALL subsequent LLM calls across ALL concurrent requests use ONLY that one provider. Under load, this can cascade into a single-provider bottleneck.

### Suggested Fix

Wrap the mutation in `try/finally`:
```typescript
try {
  process.env.LLM_PROVIDER_ORDER = provider
  // ... do work ...
} finally {
  process.env.LLM_PROVIDER_ORDER = original
}
```

---

## HIGH ISSUE #2 — Client Timeout (180s) < Server maxDuration (300s)

### File / Lines
`src/store/chat-store.ts:586` (client) vs `src/app/api/agent/route.ts:12` (server)

### What's Wrong

- Server `maxDuration = 300` (Vercel Pro)
- Client `AbortSignal.timeout(180_000)`
- Missions taking 200-280s (within server limit) get aborted at 180s on the client
- User sees an error while the server is still working

The comment at chat-store.ts:574-576 says "180s gives the agent enough time" — but 180 < 300.

### Impact

User experience: long missions fail even when they would succeed. The agent looks unreliable.

### Suggested Fix

Bump `chat-store.ts:586` from `180_000` to `290_000` (give 10s buffer for final response).

---

## HIGH ISSUE #3 — PreWarmDb Fires `/api/health` Which Is a NO-OP for DB Warming

### File / Lines
`src/components/providers/pre-warm-db.tsx:34` + `src/app/api/health/route.ts:31-43`

### What's Wrong

`PreWarmDb` is mounted on chat page load. It calls `/api/health` thinking it warms the DB. But `/api/health` returns a static JSON `{ ok: true, ... }` and **never touches the database**. The 3 endpoints that DO warm the DB (`/api/conversations`, `/api/memory`, `/api/subagents`) are called sequentially AFTER the no-op health check.

### Impact

- Cold-start page load: +5–10s (Vercel Lambda cold init + 3 sequential DB calls)
- Warm: +250ms (still hits the no-op first)
- The "prewarm" trick that was supposed to help actually hurts

### Suggested Fix

In `pre-warm-db.tsx`, fire the 3 real DB-warming endpoints in parallel using `Promise.all` instead of the no-op `/api/health`:
```typescript
await Promise.all([
  fetch('/api/conversations?limit=1'),
  fetch('/api/memory?limit=1'),
  fetch('/api/subagents'),
])
```

---

## HIGH ISSUE #4 — Stream Disconnect Leaves `_pendingTokens` Un-Flushed

### File / Lines
`src/store/chat-store.ts:514-720`

### What's Wrong

When the stream disconnects (Vercel 300s hard timeout, user clicks Stop, client 180s timeout), the post-loop `set()` and `catch` block both mark `isStreaming:false` and append error messages WITHOUT flushing `_pendingTokens`. The last ~100ms of buffered tokens are lost.

UPGRADE #154 fixed this in `applyEvent('done')` (synchronous flush at lines 1291-1309), but the abort/disconnect paths bypass that.

### Impact

Last partial sentence of every aborted/disconnected response is silently truncated. User sees "I'll help you with that..." instead of "I'll help you with that next week."

### Suggested Fix

Add a `flushPendingTokens(assistantId, set, suffix)` helper. Call it in:
- The post-loop `set` at chat-store.ts:645
- The catch block at chat-store.ts:692

---

## HIGH ISSUE #5 — Initial JS Bundle Is 314 KB Gzipped

### File / Lines
`src/components/agent/message-bubble.tsx:6` + `src/app/page.tsx:6` + `package.json`

### What's Wrong

| Chunk | Size (gzip) | Why |
|---|---|---|
| `react-markdown + remark + micromark` | 57 KB | Eagerly imported in MessageBubble |
| `framer-motion` | 38 KB | Eagerly imported in page.tsx |
| `core-js polyfills` | 41 KB | No `browserslist` in package.json |

Total: 314 KB gzipped / ~1 MB raw. Slow on mobile 3G (1.5-3s), slow on cold cache (200-400ms).

### Suggested Fix

1. Add `browserslist` to `package.json` (drops ~41 KB):
   ```json
   "browserslist": ["Chrome >= 100", "Safari >= 15", "Firefox >= 100"]
   ```
2. Lazy-load `MessageBubble` via `next/dynamic` (drops ~57 KB from initial bundle)
3. Replace `framer-motion` with CSS transitions in `AnimatePresenceHelper` (drops ~38 KB)

---

## LOW ISSUES (Won't Block, But Should Fix Eventually)

1. `runAgent` and `classifyQuerySmart` in `agent.ts:1311-1654` (344 lines) are dead code — only `runOrchestrator` is called from the API route. The duplicate `runAgent` causes maintenance drift. UPGRADE #63 acknowledged this but the dead code wasn't deleted.

2. Tool count is inconsistent across files (real count = 458, prompts claim 673+). The LLM may waste tokens on `list_tools` queries or hallucinate tool names.

3. Duplicate LLM HTTP-call implementations across 4 files (`agent.ts`, `ai-providers-integration.ts`, `enhanced-tools.ts`, `max-improvements.ts`) with divergent parameters (temperature, max_tokens, User-Agent header). Should extract a shared `callOpenAICompatible()` helper.

4. `model-router.ts` (UPGRADE #52, 182 lines) is fully dead code — was supposed to route gpt-4o vs gpt-4o-mini by complexity. Never wired up. Should delete or activate.

5. `/api/health/llm-providers`, `/api/system/diagnose-llm`, `/api/health/full-audit` all have HARDCODED chain strings (e.g., "Mistral → Groq → OpenRouter → Cerebras → Brave AI → Gemini") that don't reflect the actual `DEFAULT_ORDER`. Should extract `getProviderOrder()` and `describeActiveChain()` helpers.

---

## VERIFICATION STEPS PERFORMED

1. ✅ Read `worklog.md` and 3 audit subagent reports
2. ✅ Verified HEAD = `37424627` (2 commits after fix #168, both only touched worklog/backup files)
3. ✅ Verified `.vercel/project.json` was WRONG (pointing to `my-project`)
4. ✅ Ran `npx vercel link --project agent007-ai` to restore
5. ✅ Re-deployed — `✓ Aliased https://agent007-ai.vercel.app`
6. ✅ Deleted rogue `my-project` project from Vercel
7. ✅ Confirmed `/api/system/diagnose-llm` now returns `provider: "groq"` (was `"openai-fallback"`)
8. ✅ Confirmed `/api/health/llm-test` shows Groq (115ms), OpenAI (1203ms), Z.ai (1880ms) all PASS
9. ✅ Confirmed `.vercel/project.json` restored to `prj_L1j6UY2GvPq5cfAKQVyvqHxthGK6`
10. ✅ Created `scripts/post-deploy-verify.sh` to prevent recurrence
11. ✅ Re-ran `scripts/lock-project.sh`

---

## RECOMMENDED NEXT ACTIONS (Priority Order)

### Immediate (Today)

1. **Fix C2 (3-tier hierarchy)** — 1 file, ~20 lines. Add `dispatch?: {...}` to `Parsed` interface or use `parseOrchestrator` in subagents.ts.
2. **Fix H1 (env mutation)** — 1 file, 5 lines. Wrap in `try/finally`.
3. **Fix H2 (client timeout)** — 1 file, 1 line. Change `180_000` → `290_000`.

### This Week

4. **Fix C3 (boundary audit)** — 1 file, 5 lines. Use `result.steps` from `runSubagent`.
5. **Fix C4 (score accumulation)** — 1 file, 10 lines. Skip `storePersistentMemory` if key exists.
6. **Fix H3 (PreWarmDb)** — 1 file, ~10 lines. Replace `/api/health` with parallel fetches.
7. **Fix H4 (stream flush)** — 1 file, ~15 lines. Add `flushPendingTokens` helper.

### Next Sprint

8. **Fix C5 (fake tools)** — delete 5 fake tool entries from `TOOL_REGISTRY` (Option B).
9. **Fix H5 (bundle size)** — add `browserslist`, lazy-load MessageBubble, replace framer-motion.
10. **Cleanup LOW issues** — delete dead code, dedupe LLM helpers, extract `getProviderOrder`.

---

## TOKEN REVOCATION REMINDER

You pasted a Vercel token in this conversation. I used it for deploys and did not store it. **Please revoke it now at https://vercel.com/account/tokens.**
