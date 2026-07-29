# AUDIT-169-FINAL — Deep Audit of #168 + #169 Fixes

**Task ID:** AUDIT-169-FINAL
**Agent:** general-purpose (sub agent)
**Scope:** Find NEW issues introduced by commits 0148a33 (#168), ab1d0c9 + d4ff414 (#169).
**Method:** Read every diff in ab1d0c9/d4ff414, verify each fix in the actual file, run `node -e` for behavioral tests, confirm via `rg`/`tsc`.
**Pre-existing-issue exclusion:** Per task instructions, this report ignores 63 known pre-existing TS errors (Prisma schema mismatches, missing `imapflow`). Findings below are bugs INTRODUCED BY or whose impact was made WORSE BY #168/#169.

---

## Summary

- **1 CRITICAL** — H1 finally block pollutes env to string `"undefined"` after a thrown LLM call (regression vs. pre-#169 behavior).
- **2 HIGH** — recursive dispatch has no depth/self-dispatch guard; parseOrchestrator never populates `dispatch` from `<tool name="dispatch_subagent">`.
- **3 MEDIUM** — PreWarmDb `AbortController` is never wired; `toolEfficiencyOptimizer` reads env vars that don't exist (still misleading); throw-case env restore drops env from "one provider" to "zero providers".
- **2 LOW** — stale "180 seconds" error message; misleading commit-message wording.

Total: **8 NEW findings introduced by #168/#169.**

The remaining pre-existing issue (success-case env="undefined" string pollution on `multi_provider_compare`) is documented in Appendix A but not counted as a NEW finding.

---

## CRITICAL Findings

### C1 — H1 `process.env.LLM_PROVIDER_ORDER = undefined` doesn't delete the var (THROW-case regression)

- **Severity:** CRITICAL
- **File:Line:** `src/lib/multi-provider-comparison.ts:51, 83`
- **Code path:**
  ```ts
  const originalOrder = process.env.LLM_PROVIDER_ORDER    // line 51 → undefined (verified: env is unset on production per AUDIT-2)
  try {
    process.env.LLM_PROVIDER_ORDER = provider              // line 57
    const result = await callLlmWithRetry(messages)       // line 59 — THROWS after retries fail
    ...
  } catch (e: any) { ... }                                  // line 72
  finally {
    process.env.LLM_PROVIDER_ORDER = originalOrder         // line 83 → sets env to string "undefined"
  }
  ```
- **Verified by `node -e`:**
  ```
  process.env.X = undefined  →  process.env.X === "undefined"  (string)
  delete process.env.X        →  process.env.X === undefined
  ```
- **Impact on agent.ts:288:**
  ```ts
  const configuredOrder = (process.env.LLM_PROVIDER_ORDER || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  // After pollution: configuredOrder === ["undefined"]
  const order = configuredOrder.length > 0 ? configuredOrder : DEFAULT_ORDER  // order === ["undefined"]
  const providerEnabled = (name) => order.length === 0 ? true : order.includes(name)
  // All providers return false → NO provider is enabled → next callLlmWithRetry returns "no providers"
  ```
- **Why this is a NEW bug introduced by #169 (not pre-existing):**
  - Pre-#169 code (verified via `git show ab1d0c9^:src/lib/multi-provider-comparison.ts`):
    - SUCCESS case: env was restored inside try → "undefined" string bug (PRE-EXISTING — out of scope).
    - THROW case: env was NOT restored → env stayed as the single `provider` value (e.g. `"groq"`) → single-provider bottleneck (PRE-EXISTING — out of scope).
  - Post-#169 (H1):
    - SUCCESS case: identical to pre-#169 ("undefined" string).
    - THROW case: **CHANGED** — finally always runs and sets env to `originalOrder` = `undefined` → env becomes string `"undefined"` → next call sees `order = ["undefined"]` → **ZERO providers enabled**.
  - So in the throw case, #169 H1 swaps "single-provider bottleneck" for "no-provider-at-all failure". The worklog claim "finally guarantees restore on throw" is technically true but the restore itself is broken when env is unset.
- **Trigger:** Any `multi_provider_compare` tool invocation where `callLlmWithRetry` throws (rate-limit-after-retries, network failure, auth error). After this, every subsequent LLM call in the warm Lambda returns "no providers available" until the Lambda dies (~5-15 min idle).
- **Suggested fix:**
  ```ts
  } finally {
    if (originalOrder === undefined) {
      delete process.env.LLM_PROVIDER_ORDER   // restore the unset state
    } else {
      process.env.LLM_PROVIDER_ORDER = originalOrder
    }
  }
  ```

---

## HIGH Findings

### H1 — Recursive dispatch in runSubagent has no depth/self-dispatch guard

- **Severity:** HIGH
- **File:Line:** `src/lib/subagents.ts:1589-1646` (the `if (parsed.dispatch)` block reactivated by C2)
- **Code path:** subagents.ts:1616 calls `runSubagent({...})` recursively. The recursive call has its own `iter` counter (local var, starts at 0, capped at `SUBAGENT_MAX_ITERATIONS=15`), but **there is no recursion-depth counter anywhere in `runSubagent`'s signature or body** (verified: `rg "recursionDepth|maxDepth" src/lib/subagents.ts` → no matches).
- **Why NEW:** Before #169, `parsed.dispatch` was always `undefined` (the field didn't exist on `Parsed`) → the block was dead code → recursion never happened. After C2, `parseAssistant` populates `dispatch` from both `<dispatch_subagent>` tags and `<tool name="dispatch_subagent">` tool calls (agent.ts:1150-1155, 1165). So the recursive call now runs.
- **Concrete failure modes:**
  1. Specialist A is dispatched to do task T. A's LLM responds `<dispatch_subagent id="B">do T</dispatch_subagent>`. B is dispatched. B responds `<dispatch_subagent id="C">...`. Each level adds a stack frame + its own `conversationMessages` array. There is no cap on depth.
  2. Self-dispatch: at subagents.ts:1594-1597 the `allSubs.find` matches `dispatchAgentId` against ALL subagents including the current one. `sub.id === dispatchAgentId` is not excluded. A confused specialist can dispatch to itself → infinite recursion in a single iteration until the 300s maxDuration or stack overflow.
- **Suggested fix:**
  ```ts
  // In RunSubagentOptions:
  recursionDepth?: number
  // In runSubagent, near the top:
  const depth = opts.recursionDepth ?? 0
  if (depth >= 3) {
    finalAnswer = `⚠️ Max recursion depth (3) reached. Refusing to dispatch further — please give a final answer.`
    break
  }
  // In the dispatch block (line 1594):
  if (specialist.id === sub.id) {
    conversationMessages.push({ role: 'assistant', content })
    conversationMessages.push({ role: 'user', content: `[SUBAGENT_DISPATCH] Self-dispatch blocked ("${dispatchAgentId}" === "${sub.id}"). Do the work yourself.` })
    continue
  }
  // In the recursive runSubagent call (line 1616):
  const specialistResult = await runSubagent({
    subagentId: specialist.id, task: dispatchTask, dispatchId: `sub_${opts.dispatchId}_${Date.now()}`,
    attachments: [], language: opts.language, emit: opts.emit,
    parentConversationId: opts.parentConversationId,
    recursionDepth: depth + 1,   // ← new
  })
  ```

### H2 — parseOrchestrator still doesn't populate `dispatch` from `<tool name="dispatch_subagent">`

- **Severity:** HIGH
- **File:Line:** `src/lib/orchestrator.ts:178-194` (parseOrchestrator's toolMatch branch)
- **Why NEW:** The C2 fix updated `parseAssistant` (agent.ts:1150-1155) to populate `dispatch` from `<tool name="dispatch_subagent">` calls. The same logic was NOT added to `parseOrchestrator` (orchestrator.ts:133-197). Verify:
  - `parseOrchestrator` priority: `dispatchMatch (DISPATCH_RE)` → `dispatchSubagentMatch (DISPATCH_SUBAGENT_RE)` → `manageMatch` → `toolMatch`. The `toolMatch` branch at line 178-194 returns `{ thought, tool: { name, args }, textAfter: '', raw: content }` — **no `dispatch` field**.
  - So if the SUPER AGENT (orchestrator's callLlmWithRetry consumer) emits `<tool name="dispatch_subagent">{"id":"quill","task":"..."}</tool>`, `parseOrchestrator` returns `parsed.tool = {name:'dispatch_subagent', args:{...}}` and `parsed.dispatch = undefined`.
  - The orchestrator's main loop then falls through to the tool-dispatch path (orchestrator.ts ~line 1457) and calls `dispatchTool('dispatch_subagent', ...)`. But `dispatch_subagent` is **not** in `TOOL_REGISTRY` (verified: `rg "'dispatch_subagent'" src/lib/tools.ts` → only comments, no `TOOL_REGISTRY.dispatch_subagent = ...`). So `dispatchTool` returns "Tool not found in registry".
  - The LLM gets the error fed back. It tries again, possibly still using the tool format. Stuck loop.
- **Workaround in prompt:** The ORCHESTRATOR_PROMPT_ADDENDUM (orchestrator.ts:219-220) explicitly shows `<dispatch agent="..." task="..."/>` and `<dispatch_subagent id="...">task</dispatch_subagent>` formats, so the LLM is more likely to use those. But if it ever uses the `<tool name="dispatch_subagent">` format, the SUPER AGENT can't dispatch.
- **Suggested fix:** Mirror the parseAssistant logic in parseOrchestrator:
  ```ts
  // In parseOrchestrator toolMatch branch (after line 194):
  if (name === 'dispatch_subagent') {
    const agentId = (args?.id ?? args?.agentId ?? '').toString().trim().toLowerCase()
    const task = (args?.task ?? args?.goal ?? '').toString().trim()
    if (agentId) {
      return { thought, dispatch: { agentId, task }, textAfter: '', raw: content }
    }
  }
  ```

---

## MEDIUM Findings

### M1 — PreWarmDb `AbortController` is created but never wired to the fetches

- **Severity:** MEDIUM (resource/connection leak on rapid navigation)
- **File:Line:** `src/components/providers/pre-warm-db.tsx:41, 47, 55`
- **Code:**
  ```tsx
  const controller = new AbortController()                                       // line 41
  Promise.allSettled(
    endpoints.map((path) =>
      fetch(path, {
        method: 'GET',
        signal: AbortSignal.timeout(15_000),                                    // line 47 — uses timeout signal, NOT controller.signal
      }).catch(() => {})
    )
  ).catch(() => {})
  return () => controller.abort()                                                // line 55 — aborts NOTHING
  ```
- **Why NEW:** Pre-#169 code used a single fetch with `AbortSignal.timeout(30_000)` and no controller — it was already un-cancelable. The #169 H3 fix added `controller = new AbortController()` (suggesting cleanup intent) but never wired `controller.signal` to the fetches. The cleanup `() => controller.abort()` is dead code — `controller.signal` is never aborted, only `controller` itself (which has no listeners).
- **Impact:** If the user navigates between pages rapidly (each layout mount fires PreWarmDb's useEffect), the previous fetches are still in-flight (up to 15s each × 3 endpoints = 9 potential pending fetches per page change × N pages). Connections are held, browser connection pool can saturate.
- **Suggested fix (Node 20+/modern browsers):**
  ```ts
  signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)])
  ```
  Or simpler — pass `controller.signal` directly and let the timeout be implicit via the Lambda's own response time:
  ```ts
  signal: controller.signal
  ```

### M2 — `toolEfficiencyOptimizer` reads env vars that don't exist

- **Severity:** MEDIUM (misleading tool output — same category of bug C5 was meant to fix)
- **File:Line:** `src/lib/real-intelligence-tools.ts:399-401, 412-414, 428-430`
- **Code:**
  ```ts
  const maxIterations = Number(process.env.AGENT_MAX_ITERATIONS ?? 15)
  const maxDispatches = Number(process.env.AGENT_MAX_DISPATCHES ?? 15)
  const throttleMs = Number(process.env.LLM_THROTTLE_MS ?? 250)
  ```
- **Verified by `rg`:**
  - `rg "process\.env\.(AGENT_MAX_ITERATIONS|AGENT_MAX_DISPATCHES|LLM_THROTTLE_MS)" src/` → only matches in `real-intelligence-tools.ts:399-401`. **No other file reads or sets these env vars.**
  - Actual values (hardcoded):
    - `MAX_ITERATIONS = 50` (agent.ts:119 — "was 15, raised to 50 for max autonomy")
    - `MAX_DISPATCHES = 15` (orchestrator.ts:48)
    - `MIN_LLM_INTERVAL_MS = 250` (agent.ts:141 — comment "Reduced from 500ms → 250ms")
- **Why NEW:** The C5 fix replaced the "fake +40% speed" tool with this "real config" tool. But the "real config" reads env vars that nobody sets. The displayed `max iterations per turn: 15` is WRONG (actual is 50). The displayed `max dispatches per turn: 15` happens to match by coincidence (default `?? 15` == actual 15). The displayed `LLM throttle: 250ms` matches by coincidence.
- **Impact:** The tool's output to the LLM (and via the LLM to the user) says "max iterations per turn: 15 (AGENT_MAX_ITERATIONS)". The agent actually allows 50. The LLM may plan around 15 iterations and stop early, OR believe these are configurable when they aren't. The whole point of C5 was to remove misleading hardcoded data — this tool still has it, just under a different name.
- **Suggested fix (option A — read real constants):**
  ```ts
  import { MAX_ITERATIONS } from './agent'                                // export it from agent.ts
  import { MAX_DISPATCHES } from './orchestrator'                        // export it from orchestrator.ts
  // (MIN_LLM_INTERVAL_MS is not exported — either export it or hardcode 250 with a comment)
  ```
- **Suggested fix (option B — at least fix the wrong default):**
  ```ts
  const maxIterations = Number(process.env.AGENT_MAX_ITERATIONS ?? 50)   // matches actual MAX_ITERATIONS
  ```
  And update the comment to say "until env var support is added, these reflect the hardcoded constants".

### M3 — C1 throw-case leaves warm Lambda with zero usable providers

- **Severity:** MEDIUM (frequency depends on callLlmWithRetry throw rate; impact is HIGH when it happens)
- **File:Line:** Same as C1 (`src/lib/multi-provider-comparison.ts:83`).
- **Note:** This is the "throw case" angle of C1, broken out because the fix urgency differs:
  - The C1 issue is "always restore env to undefined → undefined string".
  - The M3 angle is "in the throw case, post-#169 is WORSE than pre-#169" (zero providers vs. one provider).
- See C1 for details and fix.

---

## LOW Findings

### L1 — Stale "180 seconds" in client timeout error message

- **Severity:** LOW (cosmetic, user-facing)
- **File:Line:** `src/store/chat-store.ts:702`
- **Code:**
  ```ts
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
    errMsg = 'The request timed out after 180 seconds. This usually means the LLM providers are slow or the mission is very complex. Click Retry to try again.'
  }
  ```
- **Why NEW:** The #169 H2 fix bumped the actual timeout from 180_000 → 290_000 (chat-store.ts:591) but did NOT update this error message at line 702. So users hitting the new 290s timeout will see "timed out after 180 seconds" — misleading.
- **Suggested fix:** Either hardcode `290` or compute from the timeout constant:
  ```ts
  errMsg = 'The request timed out after 290 seconds. This usually means the LLM providers are slow or the mission is very complex. Click Retry to try again.'
  ```

### L2 — Misleading commit message in d4ff414

- **Severity:** LOW (cosmetic, not user-facing)
- **File:Line:** Commit `d4ff414` message + comment at `src/lib/tool-testing-coordination.ts:45-49`
- **Issue:** The commit message says "5 newly-converted REAL tools" listing `self_improving_strategy, self_optimization_engine, feedback_optimization_loop, autonomous_decision_maker, decision_matrix`. But:
  - `self_improving_strategy` was REAL since #166 (per `src/lib/tools.ts:2848` comment: "REAL: queries persistent-memory learnings").
  - `decision_matrix` was REAL since #166 (per `src/lib/tools.ts:2849` comment: "REAL: weighted scoring, no Math.random").
  - Only the other 3 (`self_optimization_engine, feedback_optimization_loop, autonomous_decision_maker`) were actually converted FAKE→REAL by #169.
- **Impact:** The whitelist entries themselves are correct (all 9 should be REAL). The wording in the commit + comment is slightly inaccurate — it conflates "newly added to whitelist" with "newly converted to REAL".
- **Suggested fix:** Reword the comment:
  ```ts
  // UPGRADE #169 C5: Add 3 newly-FAKE→REAL tools (self_optimization_engine,
  // feedback_optimization_loop, autonomous_decision_maker) + 2 tools that were
  // already REAL since #166 but missing from this whitelist
  // (self_improving_strategy, decision_matrix).
  ```

---

## Verifications PASSED (no issue found)

These items from the task description were checked and are CORRECT — no finding:

| # | Check | Result |
|---|-------|--------|
| V1 | Fix #168 normalize/sort index for 'z.ai SDK', 'z.ai direct', 'z-ai', 'Groq', 'OpenAI', 'Mistral' | All return expected indices (0/1/2/3). `node -e` confirmed. |
| V2 | Fix #168 sort runs BEFORE activeProviders filter | Confirmed at agent.ts:396 (sort) → agent.ts:401 (filter). Order is correct. |
| V3 | Fix #168 fuzzy match handles supersets ('groq-fast', 'OpenAI Compatible', 'mistral-large') | All match correctly via `norm.includes(oNorm)` — intentional. |
| V4 | C2 parseAssistant dispatch extraction from both formats | Both `<dispatch_subagent>` tags (line 1165) AND `<tool name="dispatch_subagent">` tool calls (line 1150-1155) populate `dispatch`. Correct. |
| V5 | C2 subagents.ts:1589 check is now `if (parsed.dispatch)` (no `&& !parsed.tool`) | Confirmed — workaround dropped. |
| V6 | C2 `parsed.dispatch.agentId` case sensitivity matches `getAllSubagents` lookup | subagents.ts:1595-1597 uses `s.id === dispatchAgentId` (case-sensitive) OR `s.name.toLowerCase() === dispatchAgentId.toLowerCase()` (case-insensitive) — matches runSubagent entry at 1491-1492. Consistent. |
| V7 | C3 `subagentSteps` initialized to `[]` at orchestrator.ts:1262, captured from `result.steps` at 1288 | Confirmed. If `runSubagent` throws before line 1288, `subagentSteps` stays `[]` → audit's `toolsUsedInThisDispatch.length === 0` → audit skipped (line 1347). Safe. |
| V8 | C3 `subagentSteps` is used in boundary audit (not `steps`) | Confirmed at orchestrator.ts:1344 (`subagentSteps.filter(...)`). |
| V9 | C3 type annotation on `subagentSteps` (orchestrator.ts:1262) | Uses `toolResult?: any` instead of `toolResult?: ToolResult` (RunSubagentResult actual type). Type widening — compiles, only loses strictness. Not a bug. |
| V10 | C4 learning flow uses `getAllPersistentMemory` primary, `recallPersistentMemory` fallback | Confirmed at subagents.ts:1878-1886. |
| V11 | C4 fileCache 30s TTL staleness concern | `saveToFile` updates `_fileCache` synchronously (persistent-memory.ts:48), so within a single Lambda instance, writes are immediately visible. Cross-Lambda staleness is a separate pre-existing limitation, not new. |
| V12 | C5 circular import: `real-intelligence-tools.ts → ./agent` (lazy dynamic import) | `real-intelligence-tools.ts:25` statically imports `dispatchTool, ToolContext, ToolResult` from `./tools`. `tools.ts:2846` statically imports from `./real-intelligence-tools` AFTER `dispatchTool` is defined at line 981. So when real-intelligence-tools.ts loads (triggered by tools.ts line 2846), the live binding `dispatchTool` is already initialized. The dynamic `await import('./agent')` (line 360) and `await import('./tools')` (line 443) happen at runtime inside async functions — agent.ts is loaded by then. Safe in current load order. |
| V13 | C5 `toolToolUsageAnalyzer` does `await import('./tools')` — same circular concern | Safe — same analysis as V12. The runtime dynamic import resolves to the already-loaded `tools` module. |
| V14 | H1 try/finally structure restores env in finally (when `originalOrder` is set) | Confirmed — `process.env.LLM_PROVIDER_ORDER = originalOrder` is in the `finally` block at line 83. When `originalOrder` was set, the restore is correct. |
| V15 | H2 timeout comment matches code | chat-store.ts:586-591 — comment says "Bumped from 180_000 → 290_000 to match Vercel Pro maxDuration=300". Code says `AbortSignal.timeout(290_000)`. Comment matches code. |
| V16 | H3 Promise.allSettled used (doesn't reject on individual failure) | Confirmed at pre-warm-db.tsx:43-54. Each fetch has its own `.catch(() => {})` so individual failures don't reject the outer Promise. `Promise.allSettled` doesn't reject anyway. Safe. |
| V17 | d4ff414 whitelist entries are functionally correct | All 9 added entries correspond to actually-REAL tools (verified via `tools.ts` and `real-intelligence-tools.ts` source). |

---

## Non-Finding Items (pre-existing, documented for context only)

### A1 — Pre-existing "undefined" string env pollution on multi_provider_compare SUCCESS case

- **File:Line:** `src/lib/multi-provider-comparison.ts:51, 83`
- **Pre-#169 code (verified via git show):** had `process.env.LLM_PROVIDER_ORDER = originalOrder` INSIDE the try block (after `callLlmWithRetry` succeeded). When `originalOrder` was `undefined` (the default production state per AUDIT-2), this set env to the string `"undefined"` → same as post-#169 success case.
- **NOT counted as a new finding** because the success-case behavior is unchanged by #169. The CRITICAL C1 finding above is specifically about the throw case, which #169 changed from "lock to one provider" to "lock to zero providers".

### A2 — upgrade-manifest.ts is stale (no #98-#169 entries)

- **File:** `src/lib/upgrade-manifest.ts`
- **Latest entry:** `revenue_optimization_97f` (2026-07-19). No entries for upgrades #98 through #169 (~71 missing upgrades).
- **Pre-existing issue** — #168/#169 didn't cause this; they just made it slightly more stale (2 more missing).

### A3 — AUDIT-*.md files committed to git at project root (88KB total)

- **Files:** `AUDIT-FINDINGS.md` (30KB), `AUDIT-LOAD.md` (24KB), `AUDIT-PROVIDER.md` (17KB), `AUDIT-FINAL-REPORT.md` (17KB).
- **Tracked in git:** yes (`git ls-files` confirmed).
- **Cleanliness recommendation:** move to `docs/audits/` or add to `.gitignore` (audit reports are not source code and bloat the repo). Not blocking, just hygiene.

### A4 — worklog.md growth

- **Current:** 36KB / 387 lines / 7 task entries.
- **Growth rate:** ~50-100 lines per task.
- **Not yet a problem** — at current rate, will hit ~1MB after ~25 more tasks. Worth archiving old entries (e.g., older than 30 days) to `worklog-archive/` eventually, but not urgent.

---

## Top 5 Most Critical Findings (for the user)

1. **CRITICAL — `multi-provider-comparison.ts:83`**: H1's `finally` sets `process.env.LLM_PROVIDER_ORDER = undefined` which actually sets the env var to the STRING `"undefined"`. The next `callLlmWithRetry` sees `order = ["undefined"]`, all providers disabled, ALL subsequent LLM calls in the warm Lambda return "no providers available" until the Lambda dies. Fix: `if (originalOrder === undefined) delete process.env.LLM_PROVIDER_ORDER else process.env.LLM_PROVIDER_ORDER = originalOrder`.

2. **HIGH — `subagents.ts:1589-1646`**: Recursive dispatch block (reactivated by C2) has NO recursion depth limit and NO self-dispatch guard. Before #169 this was dead code; now it runs and can recurse unboundedly (A→B→C→...) until 300s maxDuration or stack overflow. Fix: add `recursionDepth` parameter, cap at 3, and `if (specialist.id === sub.id) skip dispatch`.

3. **HIGH — `orchestrator.ts:178-194`**: parseOrchestrator's `toolMatch` branch doesn't populate `dispatch` when the tool name is `dispatch_subagent` (the C2 fix only updated parseAssistant). The SUPER AGENT can't dispatch via `<tool name="dispatch_subagent">` format — falls through to `dispatchTool('dispatch_subagent', ...)` which returns "tool not found" (dispatch_subagent isn't in TOOL_REGISTRY). Fix: mirror the parseAssistant logic in parseOrchestrator.

4. **MEDIUM — `pre-warm-db.tsx:41, 47, 55`**: H3 created an `AbortController` but never wired `controller.signal` to the fetches (they use only `AbortSignal.timeout(15_000)`). The cleanup `() => controller.abort()` is dead code. If the user navigates away before all 3 fetches settle, they continue for up to 15s × 3 = potential connection-pool saturation on rapid page changes. Fix: `signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)])`.

5. **MEDIUM — `real-intelligence-tools.ts:399-401`**: `toolEfficiencyOptimizer` claims to "read ACTUAL env config" via `process.env.AGENT_MAX_ITERATIONS ?? 15`, `AGENT_MAX_DISPATCHES ?? 15`, `LLM_THROTTLE_MS ?? 250` — but NONE of these env vars are referenced anywhere else in the codebase (verified via `rg`). The actual values are hardcoded: `MAX_ITERATIONS=50` (agent.ts:119), `MAX_DISPATCHES=15` (orchestrator.ts:48), `MIN_LLM_INTERVAL_MS=250` (agent.ts:141). The tool reports `max iterations = 15` when the actual is 50. C5 was supposed to eliminate misleading hardcoded data; this tool still has it, just relabeled. Fix: import the real constants OR fix the default `?? 15` to `?? 50` for iterations.

---

## Reproduction Commands

```bash
# Verify C1 (the env = "undefined" string bug)
node -e "
  delete process.env.LLM_PROVIDER_ORDER
  const originalOrder = process.env.LLM_PROVIDER_ORDER   // undefined
  process.env.LLM_PROVIDER_ORDER = 'groq'
  process.env.LLM_PROVIDER_ORDER = originalOrder           // finally block runs this
  console.log(JSON.stringify(process.env.LLM_PROVIDER_ORDER))  // → \"undefined\"
  const order = (process.env.LLM_PROVIDER_ORDER || '').split(',').filter(Boolean)
  console.log('order:', JSON.stringify(order))             // → [\"undefined\"]
  console.log('openai enabled?', ['openai'].some(n => order.includes(n)))  // → false
"

# Verify H1 (no recursion depth limit)
rg -n "recursionDepth|maxDepth|max_depth|recursion_depth" src/lib/subagents.ts
# (no matches → no recursion limit exists)

# Verify H2 (parseOrchestrator missing dispatch extraction)
sed -n '178,194p' src/lib/orchestrator.ts
# Note: toolMatch branch returns { thought, tool, textAfter, raw } — no dispatch field

# Verify M1 (AbortController not wired)
sed -n '41,56p' src/components/providers/pre-warm-db.tsx
# Line 41: const controller = new AbortController()
# Line 47: signal: AbortSignal.timeout(15_000)    ← NOT controller.signal
# Line 55: return () => controller.abort()         ← aborts nothing

# Verify M2 (env vars don't exist anywhere else)
rg -n "process\.env\.(AGENT_MAX_ITERATIONS|AGENT_MAX_DISPATCHES|LLM_THROTTLE_MS)" src/
# Only matches: src/lib/real-intelligence-tools.ts:399-401

# Verify L1 (stale 180s message)
sed -n '700,707p' src/store/chat-store.ts
```

---

**End of report. Findings saved to `/home/z/my-project/AUDIT-169-FINAL.md`.**
