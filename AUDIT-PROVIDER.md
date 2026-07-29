# AUDIT-2 — Provider Chain Order Bug Investigation

**Task ID:** AUDIT-2
**Agent:** general-purpose (sub agent)
**Date:** 2026-07-29
**Production URL:** https://agent007-ai.vercel.app
**Source HEAD:** `3742462` (fix #168 = `0148a33` is the 3rd-most-recent commit; the 2 commits after it only touch backup files + worklog, NOT `agent.ts`)

---

## 1. Root Cause Hypothesis

There are **two co-existing bugs** that explain the user's complaint:

### PRIMARY BUG — Fix #168 is NOT actually applied to the deployed production behavior

`src/lib/agent.ts:380-396` contains the fix #168 sort:

```ts
const normalize = (s: string) => s.toLowerCase().replace(/[\s._-]/g, '')
const orderIndex = (name: string): number => {
  const norm = normalize(name)
  const i = order.findIndex(o => {
    const oNorm = normalize(o)
    return norm === oNorm || norm.includes(oNorm) || oNorm.includes(norm)
  })
  return i === -1 ? Number.MAX_SAFE_INTEGER : i
}
providers.sort((a, b) => orderIndex(a.name) - orderIndex(b.name))
```

The normalize logic IS correct (verified by `node -e`):

| Display name  | normalize()  | DEFAULT_ORDER entry | Match? | Index |
|---------------|--------------|--------------------|--------|-------|
| `Groq`        | `groq`       | `groq`             | exact  | 0     |
| `OpenAI`      | `openai`     | `openai`           | exact  | 1     |
| `z.ai SDK`    | `zaisdk`     | `z-ai` → `zai`     | `zaisdk`.includes(`zai`) → true | 2 |
| `z.ai direct` | `zaidirect`  | `z-ai` → `zai`     | `zaidirect`.includes(`zai`) → true | 2 |
| `Mistral`     | `mistral`    | `mistral`          | exact  | 3     |

So if fix #168 were live, on Vercel the chain would sort to:
**Groq → OpenAI → z.ai direct → Mistral**

Groq is **healthy and fast** (`/api/health/llm-test` returns `Groq PASS 88ms`).
OpenAI is healthy (`OpenAI PASS 529ms`).

If fix #168 were deployed, every call to `callLlmWithRetry` would try Groq first, succeed in ~88 ms, and `_provider` would be `'groq'`.

**Observed behavior:** `GET /api/system/diagnose-llm` (which calls `callLlmWithRetry`) consistently returns `testResult.provider = "openai-fallback"` across **8 consecutive calls** (timed 0.9s – 2.9s, avg ~1.4s — consistent with OpenAI being tried first and succeeding in ~529 ms + overhead).

→ Fix #168's sort is **not being executed** in the deployed function. The worklog claim "Fix #168 is LIVE on production" is either inaccurate or the deploy used a stale build that did not include commit `0148a33`'s change to `agent.ts`.

### SECONDARY BUG — Health endpoints report 3 separate, hardcoded, out-of-date chains

Even if fix #168 IS silently deployed, the user is being **actively misled** by four endpoints that each maintain their own hardcoded provider order instead of importing from `agent.ts`:

| Endpoint | Field | Reported chain | Bug |
|----------|-------|----------------|-----|
| `/api/health/llm-providers` | `activeOrder` | `['groq','openai','z-ai','mistral']` | CORRECT (it's just `DEFAULT_ORDER`) |
| `/api/health/llm-providers` | `activeChain` | `['openai','mistral','groq','z-ai']` | **WRONG** — `providers.filter(p => p.willRun).map(p => p.id)` doesn't sort by `order` index, so it returns the hardcoded declaration order (`src/app/api/health/llm-providers/route.ts:131`) |
| `/api/system/diagnose-llm` | `provider` | `"Multi-provider chain: Mistral → Groq → OpenRouter → Cerebras → Brave AI → Gemini"` | **WRONG** — third hardcoded list at `src/app/api/system/diagnose-llm/route.ts:35-45`, omits OpenAI + z.ai entirely, lists Mistral first |
| `/api/health/full-audit` | `llm-chain` detail | `"Chain: OpenAI → Mistral → Groq → OpenRouter → Brave → Gemini → z.ai"` | **WRONG** — fourth hardcoded string at `src/app/api/health/full-audit/route.ts:93`, this is the OLD pre-#164 order |

The user is almost certainly looking at one of these (likely `activeChain` in `/api/health/llm-providers`, since it directly contradicts `activeOrder` in the same payload) and concluding "the agent still doesn't recognize the new order in providers."

---

## 2. Evidence

### 2.1 Fix #168 source verification (src/lib/agent.ts)

Lines 380-396 contain the sort with the normalize helper. `git log -1 0148a33` confirms commit message:
> `fix(#168): sort provider chain by DEFAULT_ORDER so Groq is tried first`

`git diff --stat 0148a33..HEAD` confirms the 2 commits after fix #168 (`6f71142`, `3742462`) **do not touch `src/lib/agent.ts`** — only backup zips, tool-results, worklog.

### 2.2 Normalize logic verification (node -e)

```text
$ node -e "const n = (s) => s.toLowerCase().replace(/[\s._-]/g, ''); ..."
Groq     -> groq
OpenAI   -> openai
z.ai SDK -> zaisdk       (note: task description said 'zaissdk' — typo, actual is 'zaisdk')
z.ai direct -> zaidirect
z-ai     -> zai
Mistral  -> mistral
zaisdk.includes(zai)  → true   ← so 'z.ai SDK' matches 'z-ai'
zaissdk.includes(zai) → true   (task's typo also matches, but irrelevant)
```

→ Fix #168's matching logic is **correct** in source.

### 2.3 Live Groq is healthy (curl /api/health/llm-test)

```json
{"summary":"3/7 providers working","results":[
  {"provider":"Mistral","status":"fail","detail":"HTTP 401 (148ms) — Unauthorized"},
  {"provider":"Groq","status":"pass","detail":"OK (88ms) — response: \"Hi! How can I\""},
  {"provider":"OpenRouter","status":"fail","detail":"HTTP 404 (82ms) — model unavailable"},
  {"provider":"Cerebras","status":"fail","detail":"HTTP 404 (81ms) — Model does not exist"},
  {"provider":"Gemini","status":"fail","detail":"HTTP 429 (144ms) — quota exceeded"},
  {"provider":"OpenAI","status":"pass","detail":"OK (529ms) — response: \"Hi! How can I\""},
  {"provider":"Z.ai","status":"pass","detail":"OK (1413ms) — response: \"Hello 👋!\""}
]}
```

Groq (88ms) is **6× faster** than OpenAI (529ms) and healthy. If `callLlmWithRetry` tried Groq first, Groq would win every time.

### 2.4 Live callLlmWithRetry behavior (curl /api/system/diagnose-llm × 8)

```text
Call 1: Time 1.567s | provider: openai-fallback
Call 2: Time 0.990s | provider: openai-fallback
Call 3: Time 0.910s | provider: openai-fallback
Call 4: Time 0.933s | provider: openai-fallback
Call 5: Time 1.191s | provider: openai-fallback
Call 6: Time 1.494s | provider: openai-fallback
Call 7: Time 1.318s | provider: openai-fallback
Call 8: Time 2.875s | provider: openai-fallback
```

8/8 calls return `provider: "openai-fallback"`. Times (~1.4s avg) are consistent with OpenAI being tried first and succeeding in ~529 ms + overhead. If fix #168 were live, we'd see `provider: "groq"` with ~200 ms response time.

### 2.5 Live /api/health/llm-providers output (the misleading one)

```text
activeOrder: ['groq', 'openai', 'z-ai', 'mistral']   ← CORRECT
activeChain: ['openai', 'mistral', 'groq', 'z-ai']   ← WRONG (just filters, doesn't sort)
llmProviderOrderEnv: (not set, using default)         ← no env var override active
```

### 2.6 Live /api/system/diagnose-llm "provider" field

```text
"provider":"Multi-provider chain: Mistral → Groq → OpenRouter → Cerebras → Brave AI → Gemini"
"instructions":"Agent007 will try these providers in order: Mistral, Groq, OpenRouter, Cerebras, Brave AI, Gemini. (OpenAI + z.ai are disabled per owner request.)"
```

This is a 3rd hardcoded chain (Mistral-first, no OpenAI, no z.ai) at `src/app/api/system/diagnose-llm/route.ts:35-45`. The `testResult.provider: "openai-fallback"` immediately below it contradicts the hardcoded text.

### 2.7 Live /api/health/full-audit llm-chain check

```text
llm-chain pass 7/7 LLM providers configured. Chain: OpenAI → Mistral → Groq → OpenRouter → Brave → Gemini → z.ai
```

This is a 4th hardcoded chain string at `src/app/api/health/full-audit/route.ts:93`. It's the OLD pre-#164 order.

### 2.8 Env var override check

```text
$ rg "LLM_PROVIDER|PROVIDER_ORDER|configuredOrder" src/
src/app/api/health/llm-providers/route.ts:11   configuredOrder = (process.env.LLM_PROVIDER_ORDER || '')
src/app/api/health/llm-providers/route.ts:20   DEFAULT_ORDER = ['groq', 'openai', 'z-ai', 'mistral']
src/lib/multi-provider-comparison.ts:49        originalOrder = process.env.LLM_PROVIDER_ORDER
src/lib/multi-provider-comparison.ts:50        process.env.LLM_PROVIDER_ORDER = provider  ← temporary override
src/lib/multi-provider-comparison.ts:58        process.env.LLM_PROVIDER_ORDER = originalOrder
src/lib/agent.ts:288                           configuredOrder = (process.env.LLM_PROVIDER_ORDER || '')
src/lib/agent.ts:307                           DEFAULT_ORDER = ['groq', 'openai', 'z-ai', 'mistral']
```

Live env var is `(not set, using default)` → `LLM_PROVIDER_ORDER` is NOT overriding. So `DEFAULT_ORDER = ['groq', 'openai', 'z-ai', 'mistral']` is in effect.

`multi-provider-comparison.ts` does temporarily set `LLM_PROVIDER_ORDER` to test a single provider, but it restores the original value. This is only invoked from the `multi_provider_compare` tool, not the main agent path — and it sets the var to a single provider name (not a sort override).

### 2.9 Version banner (cosmetic, unrelated)

`/api/health` returns `version: "upgrade-58"` because `src/app/api/health/route.ts:36` hardcodes the string `'upgrade-58'` and was never bumped after later fixes. This is misleading but is NOT the bug — it's a cosmetic version label, not the actual deployed commit.

### 2.10 No git remote / no .next build artifacts

```text
$ git remote -v     (empty — no remote configured)
$ ls .next          (does not exist locally)
```

Deploy was done via `npx vercel --prod` (per worklog). There is no way to verify the deployed commit SHA from outside Vercel — only Vercel's dashboard/logs would confirm which commit is actually live.

---

## 3. Confirmation of Call Sites

### 3.1 Call sites that USE the fixed `callLlmWithRetry` chain (would benefit from fix #168 if deployed)

| File | Line | Context |
|------|------|---------|
| `src/lib/agent.ts` | 1404 | Main agent loop (`runAgent`/equivalent) |
| `src/lib/orchestrator.ts` | 922 | Orchestrator's main LLM call |
| `src/lib/subagents.ts` | 1559 | `runSubagent` LLM call |
| `src/lib/ceo-presenter.ts` | 102 | CEO presentation LLM call |
| `src/lib/super-agent-verifier.ts` | 143 | Verifier LLM call |
| `src/lib/mission-pipeline.ts` | 326 | CEO mission stage special case |
| `src/app/api/mission-active/[missionId]/route.ts` | 104 | CEO route handler |
| `src/app/api/system/diagnose-llm/route.ts` | 52 | Diagnostic endpoint (the one we tested) |
| `src/lib/multi-provider-comparison.ts` | 52 | `multi_provider_compare` tool (with `LLM_PROVIDER_ORDER` temp override) |

### 3.2 Call sites that BYPASS the chain and call OpenAI directly

| File | Line | Bypass | Impact |
|------|------|--------|--------|
| `src/lib/enhanced-tools.ts` | 39-40 | `callFallbackLlm` directly (skips z.ai SDK primary) | Tool-internal `llm()` helper for analytics tools — NOT main agent path |
| `src/lib/max-improvements.ts` | 176-177, 190-193 | `callFallbackLlm` directly | `toolMarketAdaptationEngine` tool — NOT main agent path |

These bypasses exist within tool implementations (data analysis, market adaptation), not the conversational agent response path. They cannot explain the user's complaint about the agent itself not recognizing the new order — but they ARE inconsistencies that should be cleaned up.

### 3.3 Secondary chains (the "feature hallucinations")

| File | Line | Hardcoded chain text |
|------|------|---------------------|
| `src/app/api/health/llm-providers/route.ts` | 131 | `activeChain = providers.filter(p => p.willRun).map(p => p.id)` — doesn't sort |
| `src/app/api/system/diagnose-llm/route.ts` | 35-45 | `['Mistral', 'Groq', 'OpenRouter', 'Cerebras', 'Brave AI', 'Gemini']` — hardcoded, missing OpenAI/z.ai, Mistral first |
| `src/app/api/health/full-audit/route.ts` | 93 | `"OpenAI → Mistral → Groq → OpenRouter → Brave → Gemini → z.ai"` — hardcoded old-order string |

---

## 4. Top 3 Fixes (in priority order)

### FIX 1 (CRITICAL): Verify fix #168 is actually deployed — re-run `npx vercel --prod` from a clean checkout

The evidence (8/8 diagnose-llm calls returning `openai-fallback` despite Groq being healthy at 88ms) strongly suggests commit `0148a33` did not actually make it into the production bundle. Most likely causes:

- (a) The `npx vercel --prod` invocation in the worklog built from a stale local checkout that predated `0148a33` (e.g., from before commit `0148a33` was created, or the working tree was dirty and `next build` used a cached compilation unit).
- (b) Vercel's build cache served a previously-built function for `/api/agent` and friends (less likely since `x-vercel-cache: MISS` was returned on our curls, but cache scope is per-route).

**Action:** Run `git status` to confirm clean tree, then `git pull && npx vercel --prod` from the latest HEAD (`3742462`). After redeploy, re-curl `/api/system/diagnose-llm` — the `testResult.provider` should switch from `"openai-fallback"` to `"groq"` on most calls.

**Verification command after redeploy:**
```bash
for i in 1 2 3 4 5; do
  curl -s https://agent007-ai.vercel.app/api/system/diagnose-llm \
    | python3 -c "import sys,json;print(json.load(sys.stdin)['testResult']['provider'])"
done
# Expect: 4-5 of 'groq', possibly 0-1 of 'openai-fallback' (if Groq hits a 429)
```

### FIX 2 (HIGH): Sort `activeChain` in `/api/health/llm-providers` by `order` index

Even after FIX 1 succeeds, the `activeChain` field will still report the old hardcoded order because it just filters by `willRun` without sorting. This is the field the user is most likely looking at (since it directly contradicts `activeOrder` in the same JSON payload).

**File:** `src/app/api/health/llm-providers/route.ts:131`

**Current:**
```ts
const activeChain = providers.filter((p) => p.willRun).map((p) => p.id)
```

**Fix:**
```ts
const activeChain = providers
  .filter((p) => p.willRun)
  .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
  .map((p) => p.id)
```

This will make `activeChain === activeOrder` (when all `activeOrder` entries are configured) — which is what users expect.

### FIX 3 (MEDIUM): Eliminate the 2 remaining hardcoded chain descriptions

The user is also seeing stale text in:
- `/api/system/diagnose-llm` (line 35-45 + line 47 instructions)
- `/api/health/full-audit` (line 93)

Both should import a shared chain description helper from `agent.ts` (or a new `src/lib/provider-chain.ts`) so they can never drift again.

**Suggested refactor:** Add to `src/lib/agent.ts` (or new `src/lib/provider-chain.ts`):

```ts
export const PROVIDER_DEFAULT_ORDER = ['groq', 'openai', 'z-ai', 'mistral'] as const
export function getProviderOrder(): readonly string[] {
  const configured = (process.env.LLM_PROVIDER_ORDER || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  return configured.length > 0 ? configured : PROVIDER_DEFAULT_ORDER
}
export function describeActiveChain(): string {
  // returns "Groq → OpenAI → z.ai → Mistral" — derived from getProviderOrder()
  // honoring env keys / isVercel so it matches what callLlmWithRetry will actually try
}
```

Then have `agent.ts`, `/api/health/llm-providers`, `/api/system/diagnose-llm`, and `/api/health/full-audit` all import and use this single source of truth. Also fix the 2 bypass call sites (`enhanced-tools.ts:39-40`, `max-improvements.ts:176-193`) to call `callLlmWithRetry` instead of `callFallbackLlm` directly, so the chain is honored everywhere.

---

## 5. Summary

| Question | Answer |
|----------|--------|
| Is fix #168 in source? | **YES** (`src/lib/agent.ts:380-396`, commit `0148a33`) |
| Is the normalize logic correct? | **YES** (verified by `node -e`; task description had a typo `zaissdk` vs actual `zaisdk`, both `.includes('zai')` → true) |
| Is Groq healthy? | **YES** (`/api/health/llm-test`: PASS 88ms) |
| Does the deployed `callLlmWithRetry` actually call Groq first? | **NO** — 8/8 diagnose-llm calls returned `provider: "openai-fallback"` |
| Is `LLM_PROVIDER_ORDER` env var overriding? | **NO** (`/api/health/llm-providers` reports `(not set, using default)`) |
| Are there secondary chains? | **YES — 3 of them** (`/api/health/llm-providers` `activeChain` doesn't sort; `/api/system/diagnose-llm` has a 3rd hardcoded list missing OpenAI+z.ai with Mistral first; `/api/health/full-audit` has a 4th hardcoded old-order string) |
| Are there bypass call sites? | **YES — 2** (`enhanced-tools.ts:39-40`, `max-improvements.ts:176-193`) — both tool-internal, not main agent path |

**Bottom line:** The user's complaint is correct. Either (1) fix #168 didn't actually deploy despite the worklog claiming it did, OR (2) the user is being misled by `activeChain` / `diagnose-llm`'s `provider` text / `full-audit`'s `llm-chain` detail — three hardcoded fields that all report stale orders. **Both** issues need to be fixed: redeploy to verify fix #168 is live, and refactor the four hardcoded chain descriptions to share a single source of truth.
