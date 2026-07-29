# AUDIT-FINDINGS — Deep Audit of Upgrades #153-#168

**Auditor:** Sub Agent (AUDIT-1)
**Date:** 2026-07-29
**Scope:** /home/z/my-project — Next.js + TypeScript (Agent007 AI)
**Method:** git log --since="48 hours ago" + manual file inspection + tsc --noEmit

## Summary

Across the 16 commits (#153–#168), several upgrades are **broken at runtime**, several are **misrepresented by their comments**, and the codebase has accumulated significant **duplicate/dead code**. The TypeScript compiler catches 3 critical bugs in `subagents.ts` that block strict type-checks (but Next.js build tolerates them).

Total findings: **18** (5 CRITICAL, 6 HIGH, 5 MEDIUM, 2 LOW)

---

## CRITICAL

### C1 — `parsed.dispatch` does not exist on `Parsed` — upgrade #165 Gap #1 is dead code
- **File:Line:** `src/lib/subagents.ts:1583, 1584, 1585`
- **Evidence:**
  - `subagents.ts` line 3 imports `parseAssistant` from `@/lib/agent`.
  - `agent.ts:1090-1096` declares `export interface Parsed { thought?; tool?; textAfterTool; textBeforeTool; raw }` — **no `dispatch` field**.
  - `subagents.ts:1569` does `const parsed = parseAssistant(content)` then immediately references `parsed.dispatch` at lines 1583, 1584, 1585.
  - `tsc --noEmit` reports:
    ```
    src/lib/subagents.ts(1583,16): error TS2339: Property 'dispatch' does not exist on type 'Parsed'.
    src/lib/subagents.ts(1584,38): error TS2339: Property 'dispatch' does not exist on type 'Parsed'.
    src/lib/subagents.ts(1585,35): error TS2339: Property 'dispatch' does not exist on type 'Parsed'.
    ```
- **Why it's a problem:** At runtime `parsed.dispatch` is always `undefined`, so `if (parsed.dispatch && !parsed.tool)` is always `false`. The entire block at lines 1583-1640 — which is supposed to let leaders delegate to specialists recursively — **never executes**. UPGRADE #165 Gap #1 ("Handle dispatch_subagent INSIDE subagents") had zero effect. Subagent leaders STILL cannot dispatch to specialists.
- **Suggested fix:** Use `parseOrchestrator` (orchestrator.ts:133, returns `dispatch`), or add `dispatch` to `Parsed` in `agent.ts` and populate it the same way `parseOrchestrator` does, or replicate the DISPATCH_SUBAGENT_RE regex inline in subagents.ts.

---

### C2 — `tool_boundary_audit` in orchestrator audits the WRONG list of tools
- **File:Line:** `src/lib/orchestrator.ts:1326-1346`
- **Evidence:**
  ```ts
  const toolsUsedInThisDispatch = steps
    .filter((s: any) => s.toolName && s.finishedAt)
    .map((s: any) => s.toolName)
  if (toolsUsedInThisDispatch.length > 0) {
    const auditResult = await dispatchTool('tool_boundary_audit', {
      agentId: sub.id,
      toolsUsed: toolsUsedInThisDispatch,
    }, ...)
  ```
  - `steps` is the orchestrator's SUPER-AGENT step array — only direct tool calls by the orchestrator are pushed to it (line 1395).
  - Subagent tool calls happen INSIDE `runSubagent` (in subagents.ts) and are NOT pushed to the orchestrator's `steps`.
  - `runSubagent` returns `{ answer, steps }` (subagents.ts:1886) but only `result.answer` is consumed (orchestrator.ts:1276). The subagent's `result.steps` is ignored.
- **Why it's a problem:** The audit is comparing the SUPER AGENT's tool calls against the SUBAGENT's `allowedTools`. This will produce false positives (super agent's tools not in `sub.allowedTools`) and miss real violations (subagent's actual tool usage is never audited). UPGRADE #167 Step 5 ("REAL-TIME tool_boundary_audit in the quality gate") is fundamentally broken — it audits the wrong list.
- **Suggested fix:** Replace `steps.filter(...)` with `result.steps?.filter(s => s.toolName && s.finishedAt).map(s => s.toolName) ?? []` so the audit uses the subagent's actual tool calls.

---

### C3 — Self-learning score never accumulates (upgrade #167 Step 3 is broken)
- **File:Line:** `src/lib/subagents.ts:1854-1881`
- **Evidence:** The block does this in order:
  1. Line 1859-1864: `storePersistentMemory(learningKey, value, 'self_learning', score=75 or 25)`.
  2. `storePersistentMemory` in `persistent-memory.ts:76-81` **OVERWRITES** the existing entry:
     ```ts
     const existingIdx = entries.findIndex(e => e.key === key)
     if (existingIdx >= 0) { entries[existingIdx] = entry }  // full replace
     ```
  3. Line 1875-1880: Re-recall the learning and call `updateMemoryScore(key, succeeded)` which moves score ±10.
  - Net effect per success run: stored as 75 → updated to 85. Per failure run: stored as 25 → updated to 15. The score **oscillates between two values** and never accumulates.
- **Why it's a problem:** The UPGRADE #167 Step 3 comment at lines 1865-1872 claims: *"a task that succeeded 5 times has score ~95, while one that failed 3 times has score ~15."* This is FALSE. The score can only ever be 75+10=85 (success) or 25-10=15 (failure). The "REAL confidence trend" promised by the upgrade does not exist.
- **Suggested fix:** Either skip `storePersistentMemory` when the key already exists, OR pass the existing score through and only update incrementally (e.g., `storePersistentMemory(key, value, cat, existingScore + (succeeded ? 10 : -10))`).

---

### C4 — 5 of 7 "FAKE tools replaced" by upgrade #166 were NOT replaced
- **File:Line:** `src/lib/real-intelligence-tools.ts:6-18` (claims) vs `src/lib/tools.ts:2844-2851` (reality)
- **Evidence:** Header comment in `real-intelligence-tools.ts` claims 7 fake tools were replaced:
  1. `toolSelfImprovingStrategy` — **REPLACED** (tools.ts:2844 overwrites TOOL_REGISTRY.self_improving_strategy)
  2. `toolSelfOptimizationEngine` — **NOT REPLACED**. Still uses `intelligence-tools-v3.ts:98` (returns hardcoded "47,318 actions analyzed", "67 learnings", "+34% decision quality" — all fake). No REAL replacement defined or imported.
  3. `toolFeedbackOptimizationLoop` — **NOT REPLACED**. Still uses `performance-enhancement-tools.ts:234` (returns hardcoded "47 learnings", "+78% conversion", "NPS: +47", fake A/B test results).
  4. `toolAutonomousDecisionMaker` — **NOT REPLACED**. Still uses `performance-enhancement-tools.ts:730` (returns hardcoded "$4,820/month", "$890/mo projected", "Confidence: 0.87", fake 10-step framework).
  5. `toolDecisionMatrix` — **REPLACED** (tools.ts:2845 overwrites). The OLD fake one in `full-autonomy-tools.ts:787` (uses `Math.random()` at line 815) is now dead code but still imported.
  6. `toolEfficiencyOptimizer` — **NOT REPLACED**. Still uses `performance-booster-tools.ts:201` (returns hardcoded "+40% speed improvement", "5 recommendations" — all fake).
  7. `toolUsageAnalyzer` — **NOT REPLACED**. Still uses `performance-booster-tools.ts:209` (partially real — queries TOOL_REGISTRY — but hardcodes "MOST POWERFUL TOOLS" recommendations).
- **Why it's a problem:** The agent continues to use 5 fake "intelligence" tools that return hallucinated metrics. The upgrade's claim that fake tools were "replaced by REAL ones" is misleading — only 2 of 7 were actually replaced. Users calling `self_optimization_engine`, `feedback_optimization_loop`, `autonomous_decision_maker`, `efficiency_optimizer`, or `tool_usage_analyzer` still get fake data.
- **Suggested fix:** Either implement REAL versions of the 5 remaining tools in `real-intelligence-tools.ts` and wire them up in `tools.ts`, OR update the misleading header comment to reflect the actual scope (only 2 of 7 replaced).

---

### C5 — `process.env.LLM_PROVIDER_ORDER` mutation in `multi-provider-comparison.ts` is not restored on throw
- **File:Line:** `src/lib/multi-provider-comparison.ts:49-58`
- **Evidence:**
  ```ts
  const originalOrder = process.env.LLM_PROVIDER_ORDER
  process.env.LLM_PROVIDER_ORDER = provider       // mutate global env
  const result = await callLlmWithRetry(messages)  // can throw
  // ... (try body)
  process.env.LLM_PROVIDER_ORDER = originalOrder  // restore in TRY only
  } catch (e: any) {
    return { provider, model: provider, content: '', ok: false, error: e?.message?.slice(0, 200), ... }
    // NO restore — env var stays mutated
  }
  ```
- **Why it's a problem:** If `callLlmWithRetry` throws (rate limit, network, auth), `LLM_PROVIDER_ORDER` is permanently stuck at the single-provider value for the lifetime of the Vercel warm instance. Every subsequent LLM call (across all concurrent requests in that instance) will use ONLY that one provider — until the instance cold-starts. If that provider is rate-limited, the entire agent becomes non-functional.
- **Suggested fix:** Move the restore into a `try/finally` block, or use a different mechanism (e.g., pass the order as an argument to `callLlmWithRetry` instead of mutating env).

---

## HIGH

### H1 — Client-side timeout (180s) is shorter than server maxDuration (300s)
- **File:Line:** `src/store/chat-store.ts:586` (client) vs `src/app/api/agent/route.ts:12` (server)
- **Evidence:**
  - Server: `export const maxDuration = 300` (300 seconds — Vercel Pro limit)
  - Client: `signal: AbortSignal.timeout(180_000)` (180 seconds)
  - Comment at chat-store.ts:574-576 says: *"Increased to 180s (server maxDuration is now 300s on Vercel Pro). Before: 90s timeout (server was 60s). After: 180s gives the agent enough time to complete complex missions with subagent dispatches."*
- **Why it's a problem:** If a mission legitimately takes 200-280 seconds (within the 300s server limit), the client aborts at 180s and the user sees an error — but the server is still working. The response is discarded. The comment claims this gives enough time, but 180 < 300 means legitimate complex missions get cut off.
- **Suggested fix:** Increase the client timeout to ~290s (give 10s buffer below server's 300s hard limit) so legitimate long missions aren't prematurely aborted.

---

### H2 — `runAgent` in `agent.ts` (344 lines) is dead code, still maintained
- **File:Line:** `src/lib/agent.ts:1311-1654` (function `runAgent`)
- **Evidence:**
  - `runAgent` is only DEFINED — never imported or called anywhere in `src/`.
  - `/api/agent/route.ts:108` calls `runOrchestrator`, not `runAgent`.
  - `upgrade-manifest.ts:571` explicitly notes: *"Upgrade #63 fixed runAgent() in agent.ts, but /api/agent uses runOrchestrator() — so #63 had ZERO effect. This upgrade applied ALL fixes to the orchestrator."* The fix was to apply changes to BOTH files, but only `runOrchestrator` is the live path.
- **Why it's a problem:** `runAgent` (lines 1311-1654 = ~344 lines) contains duplicate logic: heartbeat emission, multi-dispatch detection, continue-command support, classifyQuerySmart, tool-awareness reminder, conversation-anchor injection — all also present in `runOrchestrator`. The dead code adds maintenance burden: any future fix must be applied twice, and forgetting one creates drift. The duplicate `classifyQuerySmart` (agent.ts:1264) vs `classifyQuery` (orchestrator.ts:539) is also dead.
- **Suggested fix:** Delete `runAgent` and `classifyQuerySmart` from `agent.ts`, or deprecate them with a clear `@deprecated` comment so future maintainers don't update them.

---

### H3 — Tool count is inconsistent across files (real count ≈ 458, prompts claim 673+)
- **File:Line:** Multiple
- **Evidence:**
  - `rg -c "TOOL_REGISTRY\." src/lib/tools.ts` returns **458** (some are dynamic, but ~458 assignments).
  - `src/lib/agent.ts:52` (SYSTEM_PROMPT): *"You have 673+ tools."*
  - `src/lib/agent.ts:1560` (anti-amnesia reminder): *"YOU HAVE 567+ TOOLS (UPGRADE #62)"*
  - `src/lib/subagents.ts:174`: *"ALL 469+ tools"*
  - `src/lib/subagents.ts:1097`: *"audit all 667 tools"*
  - `src/lib/subagents.ts:1510`: *"The Super Agent (orchestrator) still has all 667 tools."*
  - `src/lib/subagents.ts:1707`: *"ALL 452 tools were available"*
  - `src/lib/orchestrator.ts:819`: *"20 subagents"*
  - `src/lib/subagents.ts:7`: *"20 specialists (12 built-in + 8 custom)"*
- **Why it's a problem:** The agent's SYSTEM_PROMPT tells the LLM it has 673+ tools, but the actual count is ~458. The LLM may attempt to call tools that don't exist (hallucinating names) or waste tokens calling `manage action="list_tools"` to verify. The subagent count is also wrong: SUBAGENTS array has **18** built-ins (aurora, vertex, quantum, scout, hunt, forge, quill, prism, pulse, echo, legal, banker, trader, cybersecurity_a, cybersecurity_r, developer, testfast2, fasttest3), not 12. The orchestrator's new compressed prompt lists 16 + "Plus 3 custom test agents" = 19, still wrong.
- **Suggested fix:** Compute the actual count dynamically (e.g., `Object.keys(TOOL_REGISTRY).length`) and inject it into the prompt, OR audit every "N tools" mention and align them to the real number. Also fix the SUBAGENTS header comment to reflect 18 built-ins.

---

### H4 — Duplicate LLM HTTP call implementations across 4 files
- **File:Line:** Multiple
- **Evidence:**
  - `src/lib/agent.ts:667` — `callGroqLlm` (internal router use)
  - `src/lib/agent.ts:625` — `callMistralLlm`
  - `src/lib/agent.ts:535` — `callGeminiLlm`
  - `src/lib/agent.ts:734` — `callOpenRouterLlm`
  - `src/lib/agent.ts:823` — `callBraveLlm`
  - `src/lib/agent.ts:885` — `callCerebrasLlm`
  - `src/lib/agent.ts:970` — `callZaiDirectLlm`
  - `src/lib/llm-fallback.ts:103` — `callFallbackLlm` (OpenAI)
  - `src/lib/ai-providers-integration.ts:20` — `toolCerebrasLLM` (separate fetch)
  - `src/lib/ai-providers-integration.ts:37` — `toolSambaNovaLLM`
  - `src/lib/ai-providers-integration.ts:54` — `toolTogetherLLM`
  - `src/lib/ai-providers-integration.ts:71` — `toolMistralLLM` (duplicate of `callMistralLlm`)
  - `src/lib/ai-providers-integration.ts:88` — `toolHuggingFaceLLM`
  - `src/lib/ai-providers-integration.ts:106` — `toolCloudflareLLM`
  - `src/lib/ai-providers-integration.ts` — `toolCohereLLM` (line 122+)
- **Why it's a problem:** Two layers of LLM-call code exist: (a) the internal router in `agent.ts` and `llm-fallback.ts`, and (b) the agent-callable "tool" versions in `ai-providers-integration.ts`. The "tool" versions use different (often outdated) parameters — e.g., `toolCerebrasLLM` uses `temperature: 0.3, max_tokens: 8000` while `callCerebrasLlm` uses `temperature: 0.7, max_tokens: 12000, top_p: 0.95` and includes the User-Agent header to bypass Cloudflare. The tool version will fail on Cloudflare-protected endpoints. Drift between the two makes maintenance error-prone.
- **Suggested fix:** Have the `ai-providers-integration.ts` tool versions delegate to the internal router functions, OR extract a shared `callOpenAICompatible(url, key, model, body)` helper used by both layers.

---

### H5 — `model-router.ts` (UPGRADE #52) is fully dead code, never wired in
- **File:Line:** `src/lib/model-router.ts:1-182` (entire file)
- **Evidence:**
  - `rg "getModelConfig|classifyTaskComplexity" src/` returns matches only inside `model-router.ts` itself and `upgrade-manifest.ts:463` (description).
  - No `import` of `model-router` anywhere in `src/`.
  - `llm-fallback.ts:21` hardcodes `gpt-4o` via `OPENAI_MODEL` env var, ignoring complexity classification.
  - `agent.ts` provider chain (line 319) always uses `callFallbackLlm` for OpenAI, no model selection by task type.
- **Why it's a problem:** UPGRADE #52 promised "+15% intelligence on complex tasks, -30% cost on simple tasks" via gpt-4o vs gpt-4o-mini routing. This never worked — the file was added but never imported. The agent has been running on a single hardcoded model this entire time. The 182 lines of code + cache logic are pure dead weight.
- **Suggested fix:** Either delete `model-router.ts`, or wire it into `llm-fallback.ts:103` so `callFallbackLlm` picks the model based on the user's last message.

---

### H6 — `_pendingTokens` / `_tokenFlushTimer` are module-level singletons, shared across all chats
- **File:Line:** `src/store/chat-store.ts:834-835`
- **Evidence:**
  ```ts
  let _pendingTokens = ''
  let _tokenFlushTimer: ReturnType<typeof setTimeout> | null = null
  ```
  These are declared at module scope (not inside the zustand store), so there's exactly one pair for the entire browser tab.
- **Why it's a problem:** If two chats are mounted in the same tab (e.g., the user opens two conversation panels simultaneously), tokens from chat A can be flushed into chat B's message — corrupting the displayed content. Even in single-chat use, the safety-net code added by UPGRADE #163 at chat-store.ts:626-639 is **dead code**: `_pendingTokens` is set to `''` synchronously in `applyEvent('done')` at line 1293, so the outer-loop check `if (_pendingTokens)` at line 626 is always false by the time it runs.
- **Suggested fix:** Move these into per-message state (e.g., a `WeakMap<messageId, {tokens, timer}>`), and delete the dead outer-loop safety net.

---

## MEDIUM

### M1 — `agent.ts` "tool awareness reminder" injects fake tool list every 2 iterations
- **File:Line:** `src/lib/agent.ts:1560-1569`
- **Evidence:**
  ```ts
  const toolAwarenessReminder = `[SYSTEM REMINDER — YOU HAVE 567+ TOOLS (UPGRADE #62)]
  ...
  You HAVE: memory_store, memory_recall, decision_matrix, autonomous_decision_maker,
  self_improving_strategy, performance_optimizer, feedback_optimization_loop,
  task_automation_expander, advanced_trend_analyzer, repetitive_task_automator,
  self_optimization_engine, quantum_revenue_optimizer, financial_tracker,
  smart_tool_router, parallel_executor, accuracy_checker, web_search, ddg_search,
  brave_search, page_reader, http_fetch, file_read, file_write, source_read,
  code_exec, image_gen, vision, + 540 more.`
  ```
  - The list says "567+ TOOLS" but the actual count is ~458 (see H3).
  - Several tools listed (`autonomous_decision_maker`, `feedback_optimization_loop`, `self_optimization_engine`) are the FAKE tools that UPGRADE #166 was supposed to replace (see C4) — they still return hardcoded fake data.
- **Why it's a problem:** The reminder actively steers the LLM toward fake tools. The LLM calls them, gets fake metrics, and reports them to the user as if they were real analyses. This propagates fake intelligence into user-visible answers.
- **Suggested fix:** Replace the static list with a dynamic call to `Object.keys(TOOL_REGISTRY).slice(0, 30)`, and remove the fake tools from the suggested list (or replace them with real alternatives once C4 is fixed).

---

### M2 — The "Plus 3 custom test agents" line in the compressed prompt is stale
- **File:Line:** `src/lib/orchestrator.ts:227`
- **Evidence:** The new compressed `ORCHESTRATOR_PROMPT_ADDENDUM` (lines 216-237) ends with *"Plus 3 custom test agents."* But only 2 test agents are defined in `SUBAGENTS` (testfast2 at line 1121, fasttest3 at line 1190). The third is unspecified.
- **Why it's a problem:** The LLM may attempt to dispatch to a "third test agent" that doesn't exist, causing dispatch failures and confusing fallback messages. The compressed prompt lost information from the original prompt which had a more accurate count.
- **Suggested fix:** Either change "Plus 3 custom test agents" to "Plus 2 test agents" (matching the actual SUBAGENTS array), or update it to mention any custom DB agents dynamically (similar to `dynamicAgentSection` at line 806).

---

### M3 — `getBestProvider` in `provider-intelligence.ts` is defined but never called
- **File:Line:** `src/lib/provider-intelligence.ts:297-303`
- **Evidence:**
  - `getBestProvider(availableProviders)` is exported (line 297).
  - `rg "getBestProvider" src/` returns only the definition — no caller.
  - `agent.ts:225` imports `getBestProvider` from `provider-intelligence` (line 225), but never calls it.
  - UPGRADE #160 explicitly disabled the circuit breaker (`shouldSkipProvider` always returns `false`), so providers are tried in DEFAULT_ORDER sort order (after upgrade #168), not by health score.
- **Why it's a problem:** UPGRADE #159 promised "Provider Intelligence Integration" with "auto-selection of the healthiest provider." The function exists but is never used. The agent tries providers in static priority order regardless of health, which means a chronically failing provider (e.g., bad API key) is tried first on every call, wasting time before falling back. The `getHealthScore`, `recordSuccess`, and `recordFailure` functions are called for tracking, but the score is never used for selection.
- **Suggested fix:** Either call `getBestProvider(activeProviders.map(p => p.name))` to get the healthiest provider name, then sort `activeProviders` so that name is first; OR delete `getBestProvider` and update the UPGRADE #159 comment to reflect that health tracking is informational only.

---

### M4 — `recallPersistentMemory` returns DB rows with hardcoded `score: 50`, ignoring file score
- **File:Line:** `src/lib/persistent-memory.ts:111-119`
- **Evidence:**
  ```ts
  const dbMems = await db.memory.findMany({ take: 100 }).catch(() => [])
  dbEntries = dbMems.map(m => ({
    key: m.key, value: m.value, category: m.category,
    createdAt: m.createdAt.getTime(),
    score: 50,  // default
    timesRecalled: 0,
  }))
  ```
  - File entries (loaded from `/tmp` JSON) have REAL scores (0-100) set by `storePersistentMemory` and updated by `updateMemoryScore`.
  - DB entries are mapped with hardcoded `score: 50` and `timesRecalled: 0`, ignoring any score the DB might have stored (the Prisma `Memory` model has no `score` field, so this is forced).
  - The merge (line 124-125) gives FILE priority, so DB entries only appear if the file doesn't have them — meaning cross-instance learning (where instance A stores, instance B recalls) gets score 50, defeating the weighted-recall logic.
- **Why it's a problem:** On Vercel serverless, each instance has its own `/tmp` file. A learning stored by instance A and recalled by instance B (via the DB) gets `score: 50` — neutral, regardless of whether it was a high-confidence success (95) or repeated failure (15). The "weighted recall" promised by UPGRADE #167 only works within a single warm instance, not across cold starts.
- **Suggested fix:** Add a `score` column to the Prisma `Memory` model and persist it, OR encode the score in the `value` field (e.g., JSON `{ score, value }`) and parse it on recall.

---

### M5 — Orchestrator DB writes are duplicated between tool-dispatch and dispatch paths
- **File:Line:** `src/lib/orchestrator.ts:1222-1233` (dispatch) and `1471-1488` (tool)
- **Evidence:**
  - When a subagent is dispatched, the orchestrator writes one row to `db.message` with `role: 'tool'`, `toolName: 'subagent_dispatch'` (lines 1222-1233).
  - Inside `runSubagent` (subagents.ts:1787-1810), each subagent's own tool call ALSO writes a row with `role: 'tool'`, `toolName: 'subagent_tool'` and another row at subagent completion (subagents.ts:1830-1840) with `toolName: 'subagent_complete'`.
  - The orchestrator's persist call (line 1471-1488) for SUPER AGENT tool calls also writes one row per tool.
- **Why it's a problem:** Three writes per dispatch on average. For a 3-dispatch turn with 5 subagent tool calls each, that's 3 + 15 + 3 = 21 DB writes. On Vercel serverless with cold-start DB connections, this is slow and costs connection-pool slots. The history reconstruction logic in `buildHistoryMessages` (agent.ts:1200-1208) only handles `role === 'tool'` generically — the extra metadata is mostly ignored.
- **Suggested fix:** Consolidate to one summary write per dispatch, or move intermediate step writes to a batched fire-and-forget call.

---

## LOW

### L1 — Tool count in UPGRADE comments is wildly inconsistent across history
- **File:Line:** `src/lib/upgrade-manifest.ts` (multiple entries)
- **Evidence:** The upgrade manifest documents claims like "448 → 452 tools", "662 to 667 tools", "567 tools", "588+ tools", "612+ tools". The actual count in `tools.ts` is 458.
- **Why it's a problem:** Future maintainers reading the manifest will be confused about which count is correct. It also suggests the upgrade counter has been wrong many times historically.
- **Suggested fix:** Single source of truth: `Object.keys(TOOL_REGISTRY).length` evaluated at build time and reported in the manifest.

---

### L2 — `done` event safety-net flush at chat-store.ts:626 is unreachable
- **File:Line:** `src/store/chat-store.ts:621-641`
- **Evidence:** The block runs only `if (evt.event === 'done' || evt.event === 'error')`. Inside `applyEvent`, the `done` handler at line 1291-1308 already flushes `_pendingTokens` and sets it to `''`. By the time control returns to the outer loop, `_pendingTokens` is always `''`, so the safety-net check `if (_pendingTokens)` at line 626 is always false.
- **Why it's a problem:** Dead code added by UPGRADE #163. Not actively harmful, but adds 15 lines of confusing logic that future maintainers may try to "fix" without realizing it's already a no-op.
- **Suggested fix:** Remove the unreachable safety-net block; the `applyEvent` handler at line 1291-1308 already covers the case.

---

## Pre-existing TypeScript Errors in src/ (66 total)

These are NOT introduced by #153-#168 but are pre-existing and would block a strict `tsc --noEmit`. Next.js's build pipeline tolerates them. Highlights:

- `src/lib/subagents.ts(1583,16): error TS2339: Property 'dispatch' does not exist on type 'Parsed'.` (×3 — see C1)
- `src/components/agent/provider-error-banner.tsx(29,50): error TS2339: Property 'serverErrorUntil' does not exist on type 'ChatState'.` — the banner reads state that doesn't exist.
- Multiple `PrismaClient` errors (`platformConnection`, `riskProfile`, `scalingPlan`, `experiment`, `sentimentLog`) — these Prisma models don't exist in the schema. Code paths using them will crash at runtime if called.
- `src/app/api/api-keys/[id]/route.ts(52,13): error TS2339: Property 'deobf' does not exist` — referencing a non-exported function from a sibling route file.
- `src/lib/intelligence-tools.ts(220,18): error TS2339: Property 'sentimentLog' does not exist on type 'PrismaClient'` — fake/stale Prisma calls.

---

## Upgrade Marker Verification (#153-#168)

| # | Marker Claim | Actually Implemented? | Notes |
|---|---|---|---|
| #153 | Brave AI REMOVED from LLM chain | ✅ Verified | agent.ts:340 — comment-only, Brave push was commented out |
| #154 | Look up thread by CURRENT stage | ⚠️ Cannot verify in audit scope | chat-store.ts:1285 references 'done' flush; needs deeper component audit |
| #155 | maxDuration 60 → 300, timeout 90 → 180 | ✅ Verified | chat-store.ts:586, route.ts:12 — but 180 < 300 (see H1) |
| #156 | waitUntil fire-and-forget | ✅ Verified | schedules/tick/route.ts:13-29 |
| #157 | Auth-error detection | ✅ Verified | orchestrator.ts:924-957 |
| #158 | Gemini/OpenRouter/Cerebras fallback models | ✅ Verified | agent.ts:541, 736, 887 |
| #159 | Provider Intelligence Integration | ⚠️ Partial | provider-intelligence.ts:1-371 — tracking works, but `getBestProvider` never called (M3) |
| #160 | Circuit breaker disabled (shouldSkipProvider=false) | ✅ Verified | agent.ts:206-208 |
| #161 | Provider chain optimization (Groq first) | ✅ Verified | agent.ts:307 (DEFAULT_ORDER) |
| #162 | (No marker found in src/) | — | Likely a worklog-only entry |
| #163 | Remove mandatory feedback loop | ✅ Verified | orchestrator.ts:1622-1638 (block is now a removal comment) |
| #164 | Sync llm-providers with DEFAULT_ORDER | ⚠️ Cannot verify | Need to check llm-providers route (out of audit scope) |
| #165 | Wire persistent-memory + handle dispatch in subagents | ❌ BROKEN | Gap #1 (dispatch inside subagents) is dead code — see C1. Gaps #2 (allowedTools enforcement) and #3 (persistent-memory wiring) are working. |
| #166 | Replace 7 fake tools with REAL ones | ❌ MISREPRESENTED | Only 2 of 7 actually replaced — see C4 |
| #167 | Stuck-counter, score updates, boundary audit | ⚠️ PARTIALLY BROKEN | Step 3 (score accumulation) broken — see C3. Step 5 (boundary audit) audits wrong list — see C2. Steps 1, 2, 4 appear OK. |
| #168 | Sort provider chain by DEFAULT_ORDER | ✅ Verified | agent.ts:380-396 — sort logic is correct |

---

## Top 10 Most Critical Findings (for the user's report)

1. **C1** — `parsed.dispatch` doesn't exist on `Parsed`; UPGRADE #165 Gap #1 (subagent-to-specialist delegation) is dead code that never runs. 3 TS errors.
2. **C2** — Orchestrator's `tool_boundary_audit` audits the SUPER AGENT's tool list against the SUBAGENT's allowedTools (wrong list) — false positives, missed real violations.
3. **C3** — Self-learning score oscillates between two values (75↔85 / 25↔15), never accumulates — UPGRADE #167 Step 3 comment is misleading.
4. **C4** — 5 of 7 "fake tools replaced" by UPGRADE #166 were NOT replaced. Agent still calls fake `self_optimization_engine`, `feedback_optimization_loop`, `autonomous_decision_maker`, `efficiency_optimizer`, `tool_usage_analyzer` returning hardcoded hallucinated metrics.
5. **C5** — `multi-provider-comparison.ts` mutates `process.env.LLM_PROVIDER_ORDER` and doesn't restore on throw — first failure permanently locks the entire Vercel instance to one provider.
6. **H1** — Client timeout (180s) is shorter than server maxDuration (300s) — complex missions cut off prematurely.
7. **H2** — `runAgent` in agent.ts (344 lines) and `classifyQuerySmart` are dead code but still maintained, causing maintenance drift.
8. **H3** — Tool count is inconsistent: real ~458, prompts claim 673+, code claims 567/667/469/452/588 in different files.
9. **H4** — Duplicate LLM HTTP-call implementations across `agent.ts` and `ai-providers-integration.ts` with divergent parameters (temperature, max_tokens, User-Agent header).
10. **H5** — `model-router.ts` (UPGRADE #52, 182 lines) is fully dead code — promised +15% intelligence via gpt-4o vs gpt-4o-mini routing, never wired in.

---

*End of AUDIT-FINDINGS.md*
