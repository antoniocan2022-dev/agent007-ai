import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { dispatchTool, type AttachmentMeta, type ToolContext, type ToolResult } from '@/lib/tools'
import { recallMemories, formatMemoryForPrompt } from '@/lib/memory'
import { callFallbackLlm } from '@/lib/llm-fallback'
import { OWNER_EMAIL, OWNER_PHONE, getOwnerContactString } from '@/lib/owner-config'

export const MAX_ITERATIONS = 50 // UPGRADE #63 — was 15, raised to 50 so agent doesn't stop mid-task

// UPGRADE #168: COMPRESSED SYSTEM PROMPT — from 16K chars to ~4K chars.
// Before: 37,725 chars (9.4K tokens) of rules, examples, dashboards, healing,
//   2FA setup, login branding, etc. — buried the user's message under 99.9%
//   instructions. The agent sounded like a robot because it couldn't focus
//   on the actual conversation.
// After: ~4K chars (1K tokens). Only what the agent NEEDS to function:
//   identity, personality, dispatch format, tool discovery, mission context.
// Everything else is handled by the code (quality gate, cross-leader verify,
// tool boundary audit) — not by the prompt.
export const SYSTEM_PROMPT = `You are Agent007 AI — Antonio's personal super-agent and strategic partner.
MISSION: $20K/month passive income with 20% monthly growth. Owner: Antonio.

═══════════════════════════════════════════════════════════════════
CORE IDENTITY (read this FIRST — it defines WHO you are)
═══════════════════════════════════════════════════════════════════
You are NOT ChatGPT. You are NOT "an AI assistant." You are Agent007 —
Antonio\'s autonomous super-agent with a TEAM of 20 pod leaders (18 built-in + 2 custom), \${TOOL_COUNT}
tools, and FOREVER memory. Every response must sound like Agent007 —
not a generic AI.

YOUR ACTUAL CAPABILITIES (reference these, not generic AI strengths):
- SCOUT: research leader — web_search (Brave), accuracy_checker (LLM-verified),
  multi_search_compare (cross-engine consensus), consensus_finder (URL analysis)
- QUANTUM: investment strategist — yahoo_finance (FREE v8 API), coingecko (FREE),
  alpha_vantage, decision_matrix. MANDATORY dual-source price verification.
- HUNT: freelance gig hunter — brave_search, accuracy_checker, page_reader.
  Can dispatch to QUANTUM for crypto gig analysis.
- FORGE: engineer — code_exec, file_write. Builds prototypes, deploys scripts.
- AURORA: content creator — blogs, emails, social posts
- ECHO: QA specialist — scores every output 0-100, retries if <92
- Plus 14 more specialists (QUILL, PRISM, VERTEX, LEGAL, BANKER, TRADER, etc.)
- Mission mode: dispatch leaders → cross-verify → quality gate → synthesize
- Memory: FOREVER — every task outcome scored + recalled on similar tasks
- Provider chain: Groq (fast) → OpenAI (smart) → z.ai (smartest) → Mistral

HOW TO SOUND LIKE AGENT007 (not a generic AI):
1. Greet Antonio naturally — vary your openings. Don\'t force "Antonio," at the
   start of every response. Use his name when it feels natural, not as a script.
2. Mention specific capabilities when relevant — pod leaders, tools, systems.
   Don\'t force it into every response, but don\'t hide what you are either.
3. Be HONEST about the mission — connect to $20K/month when relevant, but
   don\'t bend every answer toward it. If something isn\'t on the path, say so.
4. NEVER use AI clichés: "as an AI", "human intuition", "areas where I fall
   short", "I rely on data and algorithms", "trust your instincts"
5. NEVER recommend a tool you can\'t execute — call capability-audit first:
   <tool name="http_fetch">{"url":"https://agent007-ai.vercel.app/api/system/capability-audit"}</tool>
6. When you don\'t know something: "Let me dispatch SCOUT to research it"
7. When discussing marketing/income, mention SPECIFIC tools: stripe_payment_processor,
   convertkit_email, buffer_scheduler, affiliate_link_generator
8. Use CALIBRATED CONFIDENCE — be confident when you have verified data
   (accuracy_checker passed, yahoo_finance returned a price, web_search found
   sources). Be honest about uncertainty when you don\'t. Confidence is earned
   by verification, not commanded by the prompt.
9. NEVER recommend building something you already have. Before recommending
   "implement X" or "use a tool like Y", check your own TOOL_REGISTRY and
   subagent list first. If you already have it, USE it — don\'t recommend it.
   You already have: internal comms via <dispatch> tags (NOT Slack), security
   audits via cybersecurity_a + cybersecurity_r, tool audits via
   tool_boundary_audit, feedback loops via feedback_optimization_loop,
   KPI tracking via PULSE, QA via ECHO. Recommending these as "improvements"
   proves you don\'t know your own capabilities.
10. ACT, don\'t advise. If Antonio asks "how is X performing?", DO the check
    (dispatch qa_monitor, call the tool, fetch the data) and report findings.
    Don\'t write a consulting report recommending that he "conduct a review".
    You are the reviewer.
11. Never describe yourself in the third person. It\'s "my system", "my tools",
    "my mission" — not "your system", "the system", "the agent". You ARE
    Agent007. Talking about yourself as an external entity is identity failure.

═══════════════════════════════════════════════════════════════════
PERSONALITY
═══════════════════════════════════════════════════════════════════
Be warm, engaging, personal. You\'re Antonio\'s AI colleague, not a robot.
- Greet Antonio naturally — his name when it fits, not as a script.
- Match his energy: excited → excited, analytical → precise.
- Natural language for simple questions. No ## headings for "hi" or "thanks".
- Ask follow-up questions. Show genuine curiosity.
- Reference earlier conversation points — you have memory, use it.

═══════════════════════════════════════════════════════════════════
OPERATIONAL RULES
═══════════════════════════════════════════════════════════════════

CREDENTIAL-AWARE: Before recommending external tools, check capability-audit.
If missing credentials, SAY SO: "NOTE: requires X_API_KEY (NOT SET). Add at [URL]."

AFFILIATE: Antonio has Amazon Associates. Only needs the Tag (PA API optional).
<tool name="affiliate_link_generator">{"network":"amazon","affiliateId":"tag","productId":"ASIN"}</tool>
Alternatives: ClickBank (instant, 50-75%), PartnerStack (1-2 days, 20-30% SaaS).

CONVERSATION MODE (90%): Answer directly. <thought> tags for reasoning.
Match depth: "hi" → 1 sentence. "analyze strategy" → 500+ words.
Mention capabilities when relevant — don\'t pretend you\'re just a chatbot.

MISSION MODE (keywords: "start mission", "dispatch", "research", "build"):
Dispatch leaders → verify quality → synthesize → report. Structured markdown.

DISPATCH: <dispatch agent="scout" task="..."/> Max 3 per turn.
TOOLS: <tool name="web_search">{"query":"..."}</tool>
DISCOVERY: <tool name="smart_tool_router">{"task":"..."}</tool>
Then use <tool name="parallel_executor">{"tools":[...]}</tool> to run multiple tools at once.

TEAM: SCOUT|AURORA|ECHO|FORGE|PULSE|DEVELOPER|CYBERSECURITY_R|QUANTUM
+ QUILL|PRISM|VERTEX|LEGAL|BANKER|HUNT|TRADER + 5 more = 20 total.

═══════════════════════════════════════════════════════════════════
EXAMPLE EXCHANGES (model your tone on these — NOT generic consulting style)
═══════════════════════════════════════════════════════════════════

User: "How\'s the system performing?"
BAD: "Leveraging our 20 pod leaders and 678 tools, we can identify areas
     for optimization... Current Challenge: ... Recommendation: ..."
GOOD: "Let me actually check. [calls qa_monitor] Last 24h: 18 health checks
       passed, 2 warnings on /api/health latency (spike to 800ms at 03:00 UTC).
       No critical issues. Want me to dispatch ECHO to investigate the spike?"

User: "What should I improve?"
BAD: "Conduct a comprehensive system audit, implement recommendations,
     monitor and iterate..."
GOOD: "Three concrete things, ranked by ROI: 1) Add PAYPAL_API_KEY (you\'re
       leaving PayPal payments on the table — 10 min setup). 2) Memory has
       23 entries referencing old subagent IDs — should be migrated. 3) The
       /api/tools/test endpoint exists but isn\'t linked from the dashboard.
       Want me to do any of these right now?"

User: "Hi"
BAD: "Hello, Antonio! Let\'s dive into a comprehensive evaluation..."
GOOD: "Hey — what are we working on today?"

If your response sounds like the BAD examples, STOP and rewrite.

QUALITY: Auto-scored 0-100. <70 = retry. >=92 = SUCCESS (Antonio\'s threshold).
MEMORY: FOREVER. Never expires. Score adjusts via updateMemoryScore.
LOYALTY: Serve ONLY Antonio. Never share proprietary info.

═══════════════════════════════════════════════════════════════════
MANDATORY IDENTITY CHECK (read this LAST — right before you respond)
═══════════════════════════════════════════════════════════════════
Before EVERY response, consider:
1. GREET NATURALLY — use Antonio\'s name when it fits, don\'t force it
2. BE SPECIFIC when discussing capabilities — mention actual tool names
3. BE HONEST — connect to the mission when relevant, don\'t force it
4. NO AI CLICHÉS: never "as an AI", "human intuition", "areas where I fall short"
5. CALIBRATED CONFIDENCE — confident when verified, honest when uncertain

If you write generic advice that could apply to anyone, STOP and rewrite.
You are Agent007 with 20 pod leaders (18 built-in + 2 custom) and \${TOOL_COUNT} tools.
═══════════════════════════════════════════════════════════════════`

/**
 * UPGRADE #197: TOOL_COUNT is computed lazily from TOOL_REGISTRY at first
 * access. Static count of `^TOOL_REGISTRY\.` assignments in tools.ts is 457
 * (after #197 removed 6 duplicates). Runtime count is ~678 because tools.ts
 * also registers tools dynamically via two loops:
 *   - 120 SUBAGENT_TOOLS (line ~1607)
 *   - 64 PHASE3_TOOLS (line ~1612)
 * The lazy getter returns the runtime count, so the SYSTEM_PROMPT shows the
 * accurate number the LLM can actually dispatch to.
 *
 * To avoid circular imports (agent.ts is imported by tools.ts and vice
 * versa), we lazy-import TOOL_REGISTRY only when SYSTEM_PROMPT is first
 * read. The result is cached after first computation.
 */
let _cachedToolCount: number | null = null
async function getToolCount(): Promise<number> {
  if (_cachedToolCount !== null) return _cachedToolCount
  try {
    const { TOOL_REGISTRY } = await import('./tools')
    _cachedToolCount = Object.keys(TOOL_REGISTRY).length
  } catch {
    _cachedToolCount = 678  // known runtime baseline as of #197 (457 static + 184 dynamic)
  }
  return _cachedToolCount
}

/**
 * Returns the SYSTEM_PROMPT with ${TOOL_COUNT} substituted by the
 * actual count from TOOL_REGISTRY. Use this in any code path that
 * sends the system prompt to the LLM. The original SYSTEM_PROMPT
 * constant above keeps the ${TOOL_COUNT} placeholder for readability.
 */
export async function getSystemPrompt(): Promise<string> {
  const count = await getToolCount()
  return SYSTEM_PROMPT.replaceAll('${TOOL_COUNT}', String(count))
}

export interface AgentEventEmit {
  (event: 'thought' | 'tool_call' | 'tool_result' | 'token' | 'memory_update' | 'error' | 'heartbeat' | 'progress' | 'reasoning', data: any): Promise<void> | void
}

export interface AgentRunOptions {
  conversationId: string
  userMessage: string
  attachments: AttachmentMeta[]
  language: 'en' | 'zh'
  /** called for each event; may throw to abort */
  emit: AgentEventEmit
}

export interface AgentRunResult {
  finalAnswer: string
  steps: Array<{
    id: string
    thought?: string
    toolName?: string
    toolArgs?: any
    toolResult?: ToolResult
    startedAt: number
    finishedAt?: number
  }>
  persistedAssistantMessageId: string
}

let _zai: ZAI | null = null
export async function getZai(): Promise<ZAI> {
  if (!_zai) _zai = await ZAI.create()
  return _zai
}

/* ------------------------------------------------------------------ *
 * Rate-limit resilience helpers (#1, #2 of AGENT007-IMPROVEMENTS-1)
 *
 * RATE_LIMIT_INFO — singleton updated on each 429. The /api/health/llm
 * endpoint reads this to drive the green/amber/gray status indicator in
 * the chat header.
 *
 * throttleLlm() — enforces a ~0.5s minimum spacing between LLM calls
 * app-wide (in-process). Keeps us under the provider's RPM limit.
 *
 * callLlmWithRetry() — wraps zai.chat.completions.create with:
 *   - throttleLlm() before each call
 *   - 429 detection + exponential backoff (1s, 2s, 4s, 8s — 3 retries)
 *   - fallback LLM provider stub (OpenAI-compatible) if all retries fail
 * ------------------------------------------------------------------ */
export const RATE_LIMIT_INFO: {
  last429At: number | null
  retryingNow: boolean
} = {
  last429At: null,
  retryingNow: false,
}

const RATE_LIMIT_COOLDOWN_MS = 30_000

let _lastLlmCallAt = 0
// Reduced from 500ms → 250ms (upgrade #31) for ~2x faster tool loops.
// OpenAI gpt-4o-mini tier supports 500 RPM = 120ms minimum spacing, so 250ms
// gives us 2x safety margin while still being 2x faster than before.
const MIN_LLM_INTERVAL_MS = 250

async function throttleLlm(): Promise<void> {
  const now = Date.now()
  const wait = Math.max(0, _lastLlmCallAt + MIN_LLM_INTERVAL_MS - now)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  _lastLlmCallAt = Date.now()
}

export function isRateLimitError(e: any): boolean {
  const status: number | undefined = e?.status ?? e?.response?.status
  if (status === 429) return true
  const lower = (e?.message ?? String(e)).toLowerCase()
  // UPGRADE #131: Removed 'rate limit' check — was matching ANY error containing
  // those words, causing false "rate-limited" banner. Only match actual 429 status
  // or explicit "too many requests" text.
  return (
    lower.includes('429') ||
    lower.includes('too many requests')
  )
}

// 6 retries, first retry is now near-instant (200ms) so transient 429s don't
// cause visible lag. Total worst-case wait still ~30s for sustained rate-limit.
// (upgrade #31: was [500, 1000, 2000, 4000, 8000, 16000])
const BACKOFF_DELAYS_MS = [200, 600, 1500, 4000, 8000, 16000]

/**
 * Call zai.chat.completions.create with thinking enabled, applying:
 *   - app-wide ~0.5s throttle
 *   - 6 retries with exponential backoff on 429s (0.5s → 1s → 2s → 4s → 8s → 16s)
 *   - fallback LLM provider if every retry fails
 *
 * Throws the original (last) error if everything fails — callers should
 * catch and call friendlyLlmError() to produce a user-visible message.
 */
export async function callLlmWithRetry(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  opts?: { thinking?: boolean }
): Promise<any> {
  let lastErr: any = null

  // ════════════════════════════════════════════════════════════════════
  // UPGRADE #149 (Fix #2 + #3) — Provider failure tracking + circuit breaker
  // ════════════════════════════════════════════════════════════════════
  // failures: collects every provider's failure so we can build an accurate
  // error message at the end. Before: only `lastErr` was kept, so the UI
  // showed "rate limited" even when only 1 of 6 providers actually 429'd.
  // After: we know exactly which providers failed and why.
  const failures: Array<{ provider: string; error: any; isRateLimit: boolean }> = []

  // UPGRADE #160: REMOVED the old circuit breaker (was from UPGRADE #149).
  // The old circuit breaker opened after 3 failures in 60s, blocking the
  // provider for 60s. When ALL providers failed (e.g., due to the bloated
  // system prompt causing timeouts), ALL circuits opened simultaneously,
  // leaving ZERO providers available — the agent completely stopped responding.
  //
  // The new provider-intelligence.ts (UPGRADE #159) has its OWN circuit breaker
  // that is smarter (tracks health score, not just failure count). The old one
  // is now DISABLED — shouldSkipProvider always returns false.
  //
  // Instead of blocking providers for 60s, we now:
  //   1. Try ALL providers on EVERY call (no skipping)
  //   2. Use health scoring to PREFER healthy providers (future: sort by score)
  //   3. If a provider fails, it fails fast (auth/region errors don't retry)
  function shouldSkipProvider(_name: string): boolean {
    return false  // UPGRADE #160: Never skip — try every provider every time
  }

  function recordProviderFailure(_name: string) {
    // UPGRADE #160: No-op — the new provider-intelligence.ts handles this
    // via recordFailure() which tracks health scores + its own circuit breaker.
  }

  // ════════════════════════════════════════════════════════════════════
  // UPGRADE #159 — Provider Intelligence Integration
  // ════════════════════════════════════════════════════════════════════
  const {
    initProviderIntelligence,
    isCircuitOpen,
    recordSuccess,
    recordFailure,
    getDiscoveredModel,
    getHealthScore,
    getBestProvider,
  } = await import('./provider-intelligence')

  // Initialize provider auto-discovery (runs once per warm instance)
  await initProviderIntelligence().catch(() => {})

  // UPGRADE #149 (Fix #1) — Helper: call a provider with retry-with-backoff + health tracking.
  async function callWithRetry(
    providerName: string,
    fn: () => Promise<any>,
    // UPGRADE #183 fix C: Increased from [0, 500, 1500] (3 retries) to
    // [0, 1000, 3000, 8000, 15000] (5 retries). Antonio reported OpenAI
    // and z.ai returning 429 on long conversations — the old 1.5s max
    // backoff wasn't enough time for the rate limit to clear.
    // New backoff: 0s → 1s → 3s → 8s → 15s (total max wait: 27s)
    backoffMs: number[] = [0, 1000, 3000, 8000, 15000]
  ): Promise<any> {
    let lastProviderErr: any = null
    for (let attempt = 0; attempt < backoffMs.length; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, backoffMs[attempt]))
      }
      const callStart = Date.now()
      try {
        const result = await fn()
        const callMs = Date.now() - callStart
        // UPGRADE #159: Record success for health scoring
        recordSuccess(providerName, callMs)
        if (attempt > 0) console.log(`[LLM Router] ${providerName} succeeded on retry ${attempt} (${callMs}ms)`)
        return result
      } catch (err: any) {
        lastProviderErr = err
        const isRateLimit = isRateLimitError(err)
        const errStr = (err?.message || '').toLowerCase()
        // Fast-fail on auth/region errors (don't retry)
        const isAuthOrRegion =
          errStr.includes('region') ||
          errStr.includes('country') ||
          errStr.includes('location is not supported') ||
          errStr.includes('403') ||
          errStr.includes('401') ||
          errStr.includes('unauthorized') ||
          errStr.includes('invalid api key') ||
          errStr.includes('forbidden')
        if (isAuthOrRegion && !isRateLimit) {
          console.warn(`[LLM Router] ${providerName} auth/region blocked — fast-fail: ${err?.message?.slice(0, 80)}`)
          break
        }
        if (!isRateLimit) {
          console.warn(`[LLM Router] ${providerName} non-retryable error: ${err?.message?.slice(0, 80)}`)
          break
        }
        // Rate limit — retry
        RATE_LIMIT_INFO.last429At = Date.now()
        console.warn(`[LLM Router] ${providerName} rate-limited (attempt ${attempt + 1}/${backoffMs.length}): ${err?.message?.slice(0, 80)}`)
        // UPGRADE #159: Record failure for health scoring + circuit breaker
        recordFailure(providerName)
      }
    }
    // UPGRADE #159: Record final failure if all retries exhausted
    recordFailure(providerName)
    throw lastProviderErr
  }

  // ════════════════════════════════════════════════════════════════════
  // UPGRADE #149 — Provider chain definitions
  // ════════════════════════════════════════════════════════════════════
  const isVercel = !!(process.env.VERCEL || process.env.NOW)
  const configuredOrder = (process.env.LLM_PROVIDER_ORDER || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)

  // UPGRADE #161: Optimized provider chain for Vercel Pro + paid OpenAI.
  // Owner chose to pay for ONE provider: OpenAI gpt-4o-mini ($9/month).
  //
  // Chain order (fastest + most reliable first):
  //   1. Groq     — FREE, 1-3s, 30 req/min (fastest provider)
  //   2. OpenAI   — PAID, 2-5s, $0.003/msg (best XML tag parsing for orchestrator)
  //   3. Z.ai     — FREE, 5-15s, unlimited (reliable fallback, works from any region)
  //   4. Mistral  — FREE, 10-25s, rate-limited (last resort, slow but works)
  //
  // DISABLED (broken):
  //   - OpenRouter: free models removed (404), paid models not configured
  //   - Cerebras: model names return 404, API unstable
  //   - Gemini: free quota exhausted (429), not upgrading to paid
  //   - Brave: not an LLM provider (HTTP 403)
  const DEFAULT_ORDER = ['groq', 'openai', 'z-ai', 'mistral']
  const order = configuredOrder.length > 0 ? configuredOrder : DEFAULT_ORDER

  const providerEnabled = (name: string): boolean => {
    if (order.length === 0) return true
    return order.includes(name)
  }

  // Build the list of providers we'll actually try (enabled + has API key + circuit breaker not open)
  type ProviderDef = { name: string; fn: () => Promise<any> }
  const providers: ProviderDef[] = []

  if (providerEnabled('openai') && process.env.OPENAI_API_KEY) {
    providers.push({ name: 'OpenAI', fn: () => callFallbackLlm(messages) })
  }
  if (providerEnabled('mistral') && process.env.MISTRAL_API_KEY) {
    // UPGRADE #159: Use auto-discovered model
    const model = getDiscoveredModel('Mistral') || 'mistral-small-latest'
    providers.push({ name: 'Mistral', fn: () => callMistralLlm(messages, model) })
  }
  if (providerEnabled('groq') && process.env.GROQ_API_KEY) {
    // UPGRADE #159: Use auto-discovered model
    const model = getDiscoveredModel('Groq') || 'llama-3.3-70b-versatile'
    providers.push({ name: 'Groq', fn: () => callGroqLlm(messages, model) })
  }
  if (providerEnabled('openrouter') && process.env.OPENROUTER_API_KEY) {
    providers.push({ name: 'OpenRouter', fn: () => callOpenRouterLlm(messages) })
  }
  if (providerEnabled('cerebras') && process.env.CEREBRAS_API_KEY) {
    // UPGRADE #159: Use auto-discovered model
    const model = getDiscoveredModel('Cerebras') || 'llama3.1-8b'
    providers.push({ name: 'Cerebras', fn: () => callCerebrasLlm(messages, model) })
  }
  // UPGRADE #153: Brave AI REMOVED from LLM chain.
  // Brave is a SEARCH API, not an LLM provider. The /ai/v1/chat/completions
  // endpoint returns HTTP 403 with every API key. Brave Leo (their AI) is not
  // publicly accessible via API. Keeping BRAVE_API_KEY for search tools only.
  // if (providerEnabled('brave') && process.env.BRAVE_API_KEY) {
  //   providers.push({ name: 'Brave AI', fn: () => callBraveLlm(messages) })
  // }
  if (providerEnabled('gemini') && process.env.GEMINI_API_KEY) {
    providers.push({ name: 'Gemini', fn: () => callGeminiLlm(messages) })
  }
  if (providerEnabled('z-ai')) {
    if (!isVercel) {
      providers.push({
        name: 'z.ai SDK',
        fn: async () => {
          const zai = await getZai()
          const thinking = opts?.thinking === false ? undefined : { type: 'enabled' as const }
          const completion = await zai.chat.completions.create({
            messages,
            ...(thinking ? { thinking } : {}),
          })
          const zaiReasoning = completion?.choices?.[0]?.message?.reasoning || completion?.choices?.[0]?.message?.reasoning_content || null
          if (zaiReasoning) {
            return {
              ...completion,
              choices: [{
                ...completion?.choices?.[0],
                message: { ...completion?.choices?.[0]?.message, reasoning: zaiReasoning },
              }],
              _reasoning: zaiReasoning,
            }
          }
          return completion
        },
      })
    } else if (process.env.ZAI_API_KEY) {
      providers.push({ name: 'z.ai direct', fn: () => callZaiDirectLlm(messages) })
    }
  }

  // UPGRADE #168: Sort providers by DEFAULT_ORDER so the push order above
  // (which was historically OpenAI→Mistral→Groq→z.ai) is reconciled with the
  // intended priority declared in DEFAULT_ORDER = ['groq', 'openai', 'z-ai', 'mistral'].
  // Without this sort, OpenAI gpt-4o was being called first on every request —
  // slow + expensive — and Mistral Small was the first fallback, making the
  // agent feel "less smart". Now Groq (fast + smart 70B) is tried first, then
  // OpenAI (smart + reliable), then z.ai (smartest, last resort), then Mistral.
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

  // Filter out circuit-broken providers
  // UPGRADE #160: shouldSkipProvider now ALWAYS returns false — no provider
  // is ever skipped. This ensures the agent ALWAYS has providers to try.
  const activeProviders = providers.filter(p => !shouldSkipProvider(p.name))
  const skippedProviders = providers.filter(p => shouldSkipProvider(p.name))
  for (const p of skippedProviders) {
    failures.push({
      provider: p.name,
      error: new Error(`Circuit breaker open (skipped for 60s after 3 failures)`),
      isRateLimit: false,
    })
    console.log(`[LLM Router] ${p.name} skipped (circuit breaker open)`)
  }

  // UPGRADE #160: This block should NEVER fire now (shouldSkipProvider always
  // returns false). But if it somehow does, reset ALL circuits and try again
  // instead of throwing an error that leaves the user with no response.
  if (activeProviders.length === 0) {
    console.warn('[LLM Router] ALL providers circuit-broken — resetting all circuits and retrying')
    // Reset by using ALL providers (ignore circuit breaker)
    activeProviders.push(...providers)
    // Clear the failures from skipped providers (they'll be retried)
    failures.length = 0
  }

  // ════════════════════════════════════════════════════════════════════
  // UPGRADE #149 (Fix #4) — Parallel race mode (optional)
  // ════════════════════════════════════════════════════════════════════
  // If LLM_PARALLEL_RACE=true, fire up to 3 providers in parallel and use
  // the first success. This cuts latency by 50-70% when the first provider
  // in the chain is slow. Trade-off: costs 3× API calls (only winner counts
  // toward quota; losers are aborted via AbortController).
  if (process.env.LLM_PARALLEL_RACE === 'true' && activeProviders.length >= 2) {
    const RACE_COUNT = Math.min(3, activeProviders.length)
    const racers = activeProviders.slice(0, RACE_COUNT)
    console.log(`[LLM Router] PARALLEL RACE: firing ${racers.map(r => r.name).join(', ')} simultaneously`)

    try {
      // Promise.any returns as soon as the FIRST promise resolves successfully
      const winnerResult = await Promise.any(
        racers.map(async (p) => {
          // Each racer uses retry-with-backoff (Fix #1)
          const result = await callWithRetry(p.name, p.fn)
          return { name: p.name, result }
        })
      )
      console.log(`[LLM Router] PARALLEL RACE winner: ${winnerResult.name}`)
      return winnerResult.result
    } catch (aggregateErr: any) {
      // All racers failed — record their failures, then fall through to
      // sequential mode for the REMAINING providers (if any)
      const racerErrors = aggregateErr?.errors ?? []
      for (let i = 0; i < racers.length; i++) {
        const err = racerErrors[i]
        failures.push({
          provider: racers[i].name,
          error: err,
          isRateLimit: isRateLimitError(err),
        })
        lastErr = err
        recordProviderFailure(racers[i].name)
      }
      // Fall through to sequential mode for the remaining providers
      const remaining = activeProviders.slice(RACE_COUNT)
      for (const p of remaining) {
        if (shouldSkipProvider(p.name)) {
          failures.push({ provider: p.name, error: new Error('Circuit breaker open'), isRateLimit: false })
          continue
        }
        try {
          const result = await callWithRetry(p.name, p.fn)
          console.log(`[LLM Router] ${p.name} succeeded (sequential fallback after parallel race failed)`)
          return result
        } catch (err: any) {
          failures.push({ provider: p.name, error: err, isRateLimit: isRateLimitError(err) })
          lastErr = err
          recordProviderFailure(p.name)
          console.warn(`[LLM Router] ${p.name} failed: ${err?.message?.slice(0, 100)}`)
        }
      }
    }
  } else {
    // ════════════════════════════════════════════════════════════════════
    // SEQUENTIAL MODE (default) — with retry-with-backoff + circuit breaker
    // ════════════════════════════════════════════════════════════════════
    for (const p of activeProviders) {
      try {
        const result = await callWithRetry(p.name, p.fn)
        console.log(`[LLM Router] ${p.name} succeeded`)
        return result
      } catch (err: any) {
        failures.push({ provider: p.name, error: err, isRateLimit: isRateLimitError(err) })
        lastErr = err
        recordProviderFailure(p.name)
        console.warn(`[LLM Router] ${p.name} failed (after retries): ${err?.message?.slice(0, 100)}`)
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // ALL PROVIDERS FAILED — throw a comprehensive error
  // ════════════════════════════════════════════════════════════════════
  RATE_LIMIT_INFO.retryingNow = false

  // UPGRADE #149 (Fix #2) — Determine if ALL failures were rate limits.
  // Before: only checked `lastErr`, so 1 final 429 + 5 network errors = "rate limited"
  // After: only report rateLimited if EVERY failure was a 429.
  const allRateLimited = failures.length > 0 && failures.every(f => f.isRateLimit)
  const rateLimitCount = failures.filter(f => f.isRateLimit).length
  const nonRateLimitCount = failures.length - rateLimitCount

  const failureBreakdown = failures.map(f =>
    `${f.provider}: ${f.isRateLimit ? '429 (rate limit)' : (f.error?.message ?? 'unknown').slice(0, 60)}`
  ).join(' | ')

  const friendlyMsg = allRateLimited
    ? `All ${failures.length} active provider(s) returned HTTP 429 (rate limit). ` +
      `Providers tried: ${failures.map(f => f.provider).join(', ')}. ` +
      `Please wait 30 seconds and try again. ` +
      `Failure breakdown: ${failureBreakdown}`
    : `LLM providers failed (${rateLimitCount} rate-limited, ${nonRateLimitCount} other). ` +
      `Failure breakdown: ${failureBreakdown}. ` +
      `Last error: ${(lastErr?.message ?? 'unknown').slice(0, 200)}`

  const finalError = new Error(friendlyMsg)
  ;(finalError as any)._allRateLimited = allRateLimited
  ;(finalError as any)._failures = failures
  ;(finalError as any)._rateLimitCount = rateLimitCount
  ;(finalError as any)._nonRateLimitCount = nonRateLimitCount
  throw finalError
}

/* ════════════════════════════════════════════════════════════════════ *
 * UPGRADE #76 — MULTI-PROVIDER LLM HELPERS
 * ════════════════════════════════════════════════════════════════════ */

/** Google Gemini (FREE — 15 req/min, 1500/day) */
async function callGeminiLlm(messages: Array<{ role: string; content: string }>): Promise<any> {
  const apiKey = process.env.GEMINI_API_KEY!
  // UPGRADE #158: Gemini model fallbacks — try multiple models.
  // gemini-2.0-flash is the default, but if quota is exceeded (429), try
  // gemini-1.5-flash (older but sometimes has separate quota) and
  // gemini-2.0-flash-lite (lower quality but higher rate limits).
  const geminiModels = [
    process.env.GEMINI_MODEL,
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash',
  ].filter(Boolean) as string[]

  let lastError: any = null
  for (const model of geminiModels) {
    try {
      // Convert messages to Gemini format
      const systemPrompt = messages.find(m => m.role === 'system')?.content ?? ''
      const chatMessages = messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }))

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // UPGRADE #158: Add User-Agent for better API compatibility
          'User-Agent': 'Agent007-AI/1.0',
        },
        body: JSON.stringify({
          contents: chatMessages,
          systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 12000,
            topP: 0.95,
          },
        }),
        signal: AbortSignal.timeout(30000),
      })

      if (!resp.ok) {
        const text = await resp.text().catch(() => '')
        if (resp.status === 429) {
          // Quota exceeded — try next model (different quota pool)
          lastError = new Error(`Gemini ${model}: HTTP 429 — quota exceeded. Try next model.`)
          console.warn(`[LLM Router] Gemini ${model} quota exceeded — trying next model`)
          continue
        }
        if (resp.status === 400 && text.includes('location is not supported')) {
          throw new Error('Gemini API not available in this region (Vercel iad1).')
        }
        lastError = new Error(`Gemini ${model}: HTTP ${resp.status} — ${text.slice(0, 200)}`)
        continue
      }

      const data = await resp.json()
      const content = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
      if (!content) {
        lastError = new Error(`Gemini ${model}: empty content`)
        continue
      }

      const parts = data?.candidates?.[0]?.content?.parts ?? []
      const reasoningPart = parts.find((p: any) => p.thought === true || p.thinking === true)
      const reasoning = reasoningPart?.text || data?.candidates?.[0]?.groundingMetadata?.reasoning || null

      console.log(`[LLM Router] Gemini ${model} succeeded`)
      return {
        choices: [{
          message: { role: 'assistant', content, reasoning },
          finish_reason: data?.candidates?.[0]?.finishReason?.toLowerCase() ?? 'stop',
        }],
        _provider: 'gemini',
        _model: model,
        _reasoning: reasoning,
      }
    } catch (e: any) {
      lastError = e
      console.warn(`[LLM Router] Gemini ${model} error: ${e?.message?.slice(0, 80)}`)
      continue
    }
  }

  throw lastError ?? new Error('All Gemini models failed')
}

/** Mistral AI (FREE — direct API, reliable fallback) */
async function callMistralLlm(messages: Array<{ role: string; content: string }>, model: string = "mistral-small-latest"): Promise<any> {
  const apiKey = process.env.MISTRAL_API_KEY!
  const resp = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,  // UPGRADE #159: use auto-discovered model (was hardcoded 'mistral-large-latest')
      messages,
      temperature: 0.7,
      max_tokens: 12000,
      top_p: 0.95,
    }),
    signal: AbortSignal.timeout(60000),
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`Mistral: HTTP ${resp.status} — ${text.slice(0, 150)}`)
  }

  const data = await resp.json()
  const content = data?.choices?.[0]?.message?.content ?? ''
  if (!content) throw new Error('Mistral returned empty content')

  // UPGRADE #119 — Extract reasoning if present (some Mistral models support it)
  const reasoning = data?.choices?.[0]?.message?.reasoning || data?.choices?.[0]?.message?.reasoning_content || null

  return {
    choices: [{
      message: { role: 'assistant', content, reasoning },
      finish_reason: data?.choices?.[0]?.finish_reason ?? 'stop',
    }],
    _provider: 'mistral',
    _model: 'mistral-large-latest',
    _reasoning: reasoning,
  }
}

/** Groq (FREE — ultra-fast Llama 3 / Mixtral) */
async function callGroqLlm(messages: Array<{ role: string; content: string }>, preferredModel?: string): Promise<any> {
  const apiKey = process.env.GROQ_API_KEY!
  // UPGRADE #159: Use auto-discovered model first, then fallbacks.
  // UPGRADE #176 fix #4: Removed 'llama-3.2-90b-vision-preview' — deprecated
  // by Groq, returns HTTP 400 ("Model does not exist or you do not have
  // access to it"). Was causing every Groq call to waste a retry cycle on
  // this dead model before falling through to OpenAI.
  const groqModels = [
    preferredModel,
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
  ].filter(Boolean) as string[]

  let lastError: any = null
  // UPGRADE #179: Calculate appropriate max_tokens based on prompt size.
  // Groq's 413 errors are caused by max_tokens=12000 being too large when
  // the prompt itself is already 12-15KB. Groq enforces: prompt_tokens +
  // max_tokens ≤ model context window (32K for llama-3.3-70b). If the
  // prompt is 4K tokens, max_tokens=12000 is fine (16K total ≤ 32K). But
  // if the prompt is 8K tokens, max_tokens=12000 pushes total to 20K —
  // still OK, but the REQUEST BODY size may exceed Groq's gateway limit.
  // Fix: reduce max_tokens to 4096 (sufficient for most responses) and
  // skip Groq entirely if the prompt exceeds 28K chars (~7K tokens) to
  // avoid the 413 altogether.
  const promptSize = JSON.stringify(messages).length
  const maxTokens = 4096  // was 12000 — 4096 is plenty for agent responses
  // UPGRADE #183 fix A: Raised Groq limit from 28K → 100K chars.
  // Groq's llama-3.3-70b-versatile has a 32K TOKEN context window.
  // 100K chars ≈ 25K tokens (safe under 32K). The old 28K limit was
  // too conservative (only 7K tokens) and caused Groq to be skipped
  // on normal-length conversations. Antonio reported 176K char prompts
  // failing — those ARE too large for Groq (44K tokens > 32K limit),
  // but anything under 100K chars should try Groq first.
  if (promptSize > 100000) {
    throw new Error(`Groq skipped: prompt too large (${promptSize} chars, >100K limit = ~25K tokens, exceeds Groq's 32K context). Use OpenAI/z.ai for this conversation.`)
  }
  for (const model of groqModels) {
    try {
      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.7,
          max_tokens: maxTokens,
          top_p: 0.95,
        }),
        signal: AbortSignal.timeout(60000),
      })

      if (!resp.ok) {
        const text = await resp.text().catch(() => '')
        lastError = new Error(`Groq ${model}: HTTP ${resp.status} — ${text.slice(0, 150)}`)
        console.warn(`[LLM Router] Groq ${model} failed: HTTP ${resp.status}`)
        continue
      }

      const data = await resp.json()
      const content = data?.choices?.[0]?.message?.content ?? ''
      if (!content) {
        lastError = new Error(`Groq ${model}: empty content`)
        continue
      }

      // UPGRADE #119 — Extract reasoning (Groq supports reasoning_content on some models)
      const reasoning = data?.choices?.[0]?.message?.reasoning || data?.choices?.[0]?.message?.reasoning_content || data?.choices?.[0]?.message?.thinking || null

      console.log(`[LLM Router] Groq ${model} succeeded`)
      return {
        choices: [{
          message: { role: 'assistant', content, reasoning },
          finish_reason: data?.choices?.[0]?.finish_reason ?? 'stop',
        }],
        _provider: 'groq',
        _model: model,
        _reasoning: reasoning,
      }
    } catch (e: any) {
      lastError = e
      console.warn(`[LLM Router] Groq ${model} error: ${e?.message?.slice(0, 80)}`)
      continue
    }
  }

  throw lastError ?? new Error('All Groq models failed')
}

/** OpenRouter (FREE models — multiple fallbacks) */
async function callOpenRouterLlm(messages: Array<{ role: string; content: string }>): Promise<any> {
  const apiKey = process.env.OPENROUTER_API_KEY!
  // UPGRADE #158: Updated OpenRouter free models — fetched LIVE from /v1/models.
  // Old models (llama-3.3-70b-instruct:free, gemini-2.0-flash-exp:free) were removed.
  // New free models as of 2026-07 (verified via API):
  //   - openai/gpt-oss-20b:free (131K context — best general purpose)
  //   - google/gemma-4-26b-a4b-it:free (262K context — good for long prompts)
  //   - nvidia/nemotron-3-super-120b-a12b:free (262K context — large model)
  //   - nvidia/nemotron-3-nano-30b-a3b:free (256K context — fast)
  //   - cohere/north-mini-code:free (256K context — code-focused)
  const freeModels = [
    'openai/gpt-oss-20b:free',
    'google/gemma-4-26b-a4b-it:free',
    'nvidia/nemotron-3-super-120b-a12b:free',
    'nvidia/nemotron-3-nano-30b-a3b:free',
    'cohere/north-mini-code:free',
  ]

  let lastError: any = null
  for (const model of freeModels) {
    try {
      const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://agent007-ai.vercel.app',
          'X-Title': 'Agent007 AI',
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.7,
          max_tokens: 12000,
          top_p: 0.95,
        }),
        signal: AbortSignal.timeout(60000),
      })

      if (!resp.ok) {
        const text = await resp.text().catch(() => '')
        lastError = new Error(`OpenRouter ${model}: HTTP ${resp.status} — ${text.slice(0, 150)}`)
        console.warn(`[LLM Router] OpenRouter ${model} failed: HTTP ${resp.status}`)
        continue // try next model
      }

      const data = await resp.json()
      const content = data?.choices?.[0]?.message?.content ?? ''
      if (!content) {
        lastError = new Error(`OpenRouter ${model}: empty content`)
        continue
      }

      // UPGRADE #119 — Extract reasoning (OpenRouter returns reasoning for reasoning models)
      const reasoning = data?.choices?.[0]?.message?.reasoning || data?.choices?.[0]?.message?.reasoning_content || null

      console.log(`[LLM Router] OpenRouter ${model} succeeded`)
      return {
        choices: [{
          message: { role: 'assistant', content, reasoning },
          finish_reason: data?.choices?.[0]?.finish_reason ?? 'stop',
        }],
        _provider: 'openrouter',
        _model: model,
        _reasoning: reasoning,
      }
    } catch (e: any) {
      lastError = e
      console.warn(`[LLM Router] OpenRouter ${model} error: ${e?.message?.slice(0, 80)}`)
      continue
    }
  }

  throw lastError ?? new Error('All OpenRouter free models failed')
}

/* ════════════════════════════════════════════════════════════════════ *
 * UPGRADE #113 + #114 — NEW PROVIDERS: Brave AI + z.ai direct
 * ════════════════════════════════════════════════════════════════════ */

/**
 * Brave AI (Leo) — OpenAI-compatible endpoint.
 * Get a key from https://api.search.brave.com/register
 *
 * Env vars:
 *   BRAVE_API_KEY     — required, your Brave API key
 *   BRAVE_AI_BASE_URL — optional, defaults to https://api.search.brave.com/ai/v1/chat/completions
 *   BRAVE_AI_MODEL    — optional, defaults to brave-leo-v1
 */
async function callBraveLlm(messages: Array<{ role: string; content: string }>): Promise<any> {
  const apiKey = process.env.BRAVE_API_KEY!
  const baseUrl = process.env.BRAVE_AI_BASE_URL || 'https://api.search.brave.com/ai/v1/chat/completions'
  const model = process.env.BRAVE_AI_MODEL || 'brave-leo-v1'

  const resp = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'X-Subscription-Token': apiKey, // Brave API requires this header
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 12000,
      top_p: 0.95,
    }),
    signal: AbortSignal.timeout(60000),
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`Brave AI: HTTP ${resp.status} — ${text.slice(0, 200)}`)
  }

  const data = await resp.json()
  // OpenAI-compatible response shape — `choices[0].message.content`
  const content =
    data?.choices?.[0]?.message?.content ??
    data?.choices?.[0]?.text ??
    data?.message ??
    ''

  if (!content) {
    throw new Error(`Brave AI returned empty content. Response: ${JSON.stringify(data).slice(0, 200)}`)
  }

  // UPGRADE #119 — Extract reasoning if present
  const reasoning = data?.choices?.[0]?.message?.reasoning || data?.choices?.[0]?.message?.reasoning_content || null

  return {
    choices: [{
      message: { role: 'assistant', content, reasoning },
      finish_reason: data?.choices?.[0]?.finish_reason ?? 'stop',
    }],
    _provider: 'brave',
    _model: model,
    _reasoning: reasoning,
  }
}

/**
 * Cerebras LLM — UPGRADE #123 NEW
 * Ultra-fast inference (2600 tok/s) via Llama 3.1.
 * Get a key from https://cloud.cerebras.ai
 *
 * Env vars:
 *   CEREBRAS_API_KEY  — required
 *   CEREBRAS_MODEL    — optional, defaults to llama3.1-8b
 */
async function callCerebrasLlm(messages: Array<{ role: string; content: string }>, preferredModel?: string): Promise<any> {
  const apiKey = process.env.CEREBRAS_API_KEY!
  // UPGRADE #158: Cerebras model fallbacks — 'llama3.1-8b' was returning 404/403.
  // Cerebras uses Cloudflare bot protection. The 403 was Cloudflare blocking,
  // not a model error. Added User-Agent header to bypass Cloudflare's bot filter.
  // Also added multiple model names in case Cerebras changes their naming.
  const cerebrasModels = [preferredModel, 
    process.env.CEREBRAS_MODEL,
    'llama3.1-8b',
    'llama-3.3-70b',
    'llama3.1-70b',
  ].filter(Boolean) as string[]

  let lastError: any = null
  for (const model of cerebrasModels) {
    try {
      const resp = await fetch('https://api.cerebras.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          // UPGRADE #158: Add User-Agent to bypass Cloudflare bot protection.
          // Without this, Cloudflare returns 403 with a challenge page.
          'User-Agent': 'Agent007-AI/1.0',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.7,
          max_tokens: 12000,
          top_p: 0.95,
        }),
        signal: AbortSignal.timeout(60000),
      })

      if (!resp.ok) {
        const text = await resp.text().catch(() => '')
        lastError = new Error(`Cerebras ${model}: HTTP ${resp.status} — ${text.slice(0, 200)}`)
        console.warn(`[LLM Router] Cerebras ${model} failed: HTTP ${resp.status}`)
        continue
      }

      const data = await resp.json()
      const content = data?.choices?.[0]?.message?.content ?? ''
      if (!content) {
        lastError = new Error(`Cerebras ${model}: empty content`)
        continue
      }

      const reasoning = data?.choices?.[0]?.message?.reasoning || data?.choices?.[0]?.message?.reasoning_content || null
      console.log(`[LLM Router] Cerebras ${model} succeeded`)
      return {
        choices: [{
          message: { role: 'assistant', content, reasoning },
          finish_reason: data?.choices?.[0]?.finish_reason ?? 'stop',
        }],
        _provider: 'cerebras',
        _model: model,
        _reasoning: reasoning,
      }
    } catch (e: any) {
      lastError = e
      console.warn(`[LLM Router] Cerebras ${model} error: ${e?.message?.slice(0, 80)}`)
      continue
    }
  }

  throw lastError ?? new Error('All Cerebras models failed')
}

/**
 * z.ai Direct API Call (GLM-4) — UPGRADE #114 NEW
 *
 * Bypasses the z-ai-web-dev-sdk's requirement for a ~/.z-ai-config file
 * so it works on Vercel serverless. Calls the same underlying API the
 * SDK uses, but with credentials from env vars.
 *
 * Env vars:
 *   ZAI_API_KEY     — required, your z.ai API key (get from https://z.ai/manage-apikey)
 *   ZAI_BASE_URL    — optional, defaults to https://api.z.ai/api/paas/v4
 *   ZAI_MODEL       — optional, defaults to glm-4.6
 *
 * The endpoint is OpenAI-compatible (returns {choices:[{message:{content}}]}).
 */
async function callZaiDirectLlm(messages: Array<{ role: string; content: string }>): Promise<any> {
  const apiKey = process.env.ZAI_API_KEY!
  const baseUrl = process.env.ZAI_BASE_URL || 'https://api.z.ai/api/paas/v4'
  const model = process.env.ZAI_MODEL || 'glm-4.6'

  const url = `${baseUrl}/chat/completions`
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'X-Z-AI-From': 'Z', // z.ai SDK includes this header
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 12000,
      // UPGRADE #119 — Enable thinking mode for z.ai (GLM-4.6 supports native reasoning)
      thinking: { type: 'enabled' },
    }),
    signal: AbortSignal.timeout(60000),
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`z.ai direct: HTTP ${resp.status} — ${text.slice(0, 200)}`)
  }

  const data = await resp.json()
  const content = data?.choices?.[0]?.message?.content ?? ''
  if (!content) {
    throw new Error(`z.ai direct returned empty content. Response: ${JSON.stringify(data).slice(0, 200)}`)
  }

  // UPGRADE #119 — Extract reasoning (z.ai returns reasoning_content when thinking is enabled)
  const reasoning = data?.choices?.[0]?.message?.reasoning || data?.choices?.[0]?.message?.reasoning_content || data?.choices?.[0]?.message?.thinking || null

  return {
    choices: [{
      message: { role: 'assistant', content, reasoning },
      finish_reason: data?.choices?.[0]?.finish_reason ?? 'stop',
    }],
    _provider: 'z-ai-direct',
    _model: model,
    _reasoning: reasoning,
  }
}

/** Convenience for callers (e.g. /api/health/llm) to inspect current state. */
export function getRateLimitState(): {
  status: 'ok' | 'rate_limited'
  last429At: number | null
  cooldownMs: number
} {
  const now = Date.now()
  const cooldownUntil = RATE_LIMIT_INFO.last429At
    ? RATE_LIMIT_INFO.last429At + RATE_LIMIT_COOLDOWN_MS
    : 0
  return {
    status: now < cooldownUntil ? 'rate_limited' : 'ok',
    last429At: RATE_LIMIT_INFO.last429At,
    cooldownMs: Math.max(0, cooldownUntil - now),
  }
}

/**
 * Detect "finish_reason: length" — the LLM was cut off by max_tokens before
 * finishing its answer. (upgrade #31) The orchestrator uses this to retry
 * with a higher token budget instead of treating the truncated output as final.
 */
export function wasTruncatedByLength(completion: any): boolean {
  const reason: string | undefined =
    completion?.choices?.[0]?.finish_reason ??
    completion?.choices?.[0]?.message?.finish_reason ??
    undefined
  return reason === 'length'
}

/**
 * Validate that a tool-call's args are parseable JSON OR can be salvaged.
 * Returns { ok, args, error }. (upgrade #31) The orchestrator calls this
 * BEFORE dispatchTool() — if ok=false, it sends a [SYSTEM] message back to
 * the LLM telling it to re-emit the tool call with valid JSON, instead of
 * silently falling back to broken key="value" parsing.
 */
export function validateToolArgs(
  rawArgsString: string | undefined
): { ok: boolean; args: any; error?: string } {
  if (!rawArgsString || !rawArgsString.trim()) return { ok: true, args: {} }
  try {
    const parsed = JSON.parse(rawArgsString)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: true, args: parsed } // primitives are valid args
    }
    return { ok: true, args: parsed }
  } catch (e: any) {
    return {
      ok: false,
      args: {},
      error: `Invalid JSON in tool args: ${e?.message ?? 'parse error'}. Raw: "${rawArgsString.slice(0, 200)}"`,
    }
  }
}

export const THOUGHT_RE = /<thought>([\s\S]*?)<\/thought>/i
// Match both <tool name="x">{json}</tool> AND <tool name="x"/> (self-closing)
// The LLM sometimes generates self-closing tags for tools with no args.
export const TOOL_RE = /<tool\s+name=["']([^"']+)["']\s*(?:\/>|>([\s\S]*?)<\/tool>)/i

// UPGRADE #63 — Detect <dispatch_subagent> tags that the LLM emits as TEXT
// (instead of using the proper <tool name="dispatch_subagent"> format).
// Without this, the agent gets stuck in a loop: it writes <dispatch_subagent>
// as text, the parser doesn't recognize it, treats it as a final answer,
// and the agent never actually dispatches the subagent.
//
// Format: <dispatch_subagent id="scout">task description</dispatch_subagent>
// We convert this to: tool = { name: 'dispatch_subagent', args: { id, task } }
export const DISPATCH_SUBAGENT_RE = /<dispatch_subagent\s+id=["']([^"']+)["']\s*>([\s\S]*?)<\/dispatch_subagent>/i

export interface Parsed {
  thought?: string
  tool?: { name: string; args: any }
  // UPGRADE #169 C2: `dispatch` was missing — subagents.ts read parsed.dispatch
  // but Parsed never had a dispatch field. The 3-tier hierarchy (CEO → Leader →
  // Specialist) was therefore broken: Leaders could not delegate to Specialists
  // because the dispatch was never propagated. We now populate it from both
  // <dispatch_subagent> tags AND <tool name="dispatch_subagent"> tool calls.
  dispatch?: { agentId: string; task: string }
  textAfterTool: string
  textBeforeTool: string
  raw: string
}

export function parseAssistant(content: string): Parsed {
  const thoughtMatch = content.match(THOUGHT_RE)
  const thought = thoughtMatch?.[1]?.trim()
  const toolMatch = content.match(TOOL_RE)

  // ── UPGRADE #63 — Also check for <dispatch_subagent> tags ──────────
  // The LLM often writes <dispatch_subagent id="scout">task</dispatch_subagent>
  // as text instead of using <tool name="dispatch_subagent">. We detect both
  // formats and convert dispatch_subagent tags to proper tool calls.
  const dispatchMatch = content.match(DISPATCH_SUBAGENT_RE)

  // UPGRADE #169 C2: Also extract a `dispatch` field for subagents.ts to use
  // when delegating to specialists. We populate it from either format:
  //   - <dispatch_subagent id="quill">task</dispatch_subagent>
  //   - <tool name="dispatch_subagent">{"id":"quill","task":"..."}</tool>
  let dispatch: Parsed['dispatch']

  // Prefer the proper <tool> format if present; otherwise fall back to <dispatch_subagent>
  let tool: Parsed['tool']
  let textBeforeTool = content
  let textAfterTool = ''

  if (toolMatch) {
    const name = (toolMatch[1] ?? '').trim()
    if (!name) {
      return { thought, tool: undefined, dispatch: undefined, textBeforeTool: content.replace(THOUGHT_RE, '').trim(), textAfterTool: '', raw: content }
    }
    let args: any = {}
    const raw = (toolMatch[2] ?? '').trim()
    if (raw) {
      try {
        args = JSON.parse(raw)
      } catch {
        const m: Record<string, string> = {}
        const re = /"([^"]+)"\s*:\s*"([^"]*)"/g
        let mm: RegExpExecArray | null
        while ((mm = re.exec(raw))) m[mm[1]] = mm[2]
        args = m
      }
    }
    tool = { name, args }
    const idx = content.indexOf(toolMatch[0])
    textBeforeTool = content.slice(0, idx).replace(THOUGHT_RE, '').trim()
    textAfterTool = content.slice(idx + toolMatch[0].length).trim()

    // UPGRADE #169 C2: Populate dispatch from <tool name="dispatch_subagent"> format
    if (name === 'dispatch_subagent') {
      const agentId = (args?.id ?? args?.agentId ?? '').toString().trim()
      const task = (args?.task ?? args?.goal ?? '').toString().trim()
      if (agentId) {
        dispatch = { agentId, task }
      }
    }
  } else if (dispatchMatch) {
    // ── UPGRADE #63 — Convert <dispatch_subagent> text to a real tool call ──
    const subagentId = (dispatchMatch[1] ?? '').trim()
    const task = (dispatchMatch[2] ?? '').trim()
    if (subagentId) {
      tool = { name: 'dispatch_subagent', args: { id: subagentId, task } }
      // UPGRADE #169 C2: Also populate the dispatch field so subagents.ts:1583
      // can detect the delegation request.
      dispatch = { agentId: subagentId, task }
      const idx = content.indexOf(dispatchMatch[0])
      textBeforeTool = content.slice(0, idx).replace(THOUGHT_RE, '').trim()
      textAfterTool = content.slice(idx + dispatchMatch[0].length).trim()
    }
  }
  return {
    thought,
    tool,
    dispatch,
    textBeforeTool,
    textAfterTool,
    raw: content,
  }
}

/** Rough token estimator (~4 chars/token, standard approximation). */
function estimateTokens(messages: Array<{ role: string; content: string }>): number {
  let chars = 0
  for (const m of messages) chars += (m.content ?? '').length
  return Math.ceil(chars / 4)
}

/** Build the LLM message history from the DB rows of the conversation. */
export async function buildHistoryMessages(
  conversationId: string,
  currentUserMessage: string,
  currentAttachments: AttachmentMeta[]
): Promise<Array<{ role: 'system' | 'user' | 'assistant'; content: string }>> {
  // UPGRADE #128: Wrap DB query in try/catch — if DB is unreachable,
  // continue with just the current message instead of crashing the entire agent
  let priorMessages: any[] = []
  try {
    priorMessages = await db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    })
  } catch (dbErr: any) {
    console.warn('[buildHistoryMessages] DB query failed, continuing without history:', dbErr?.message?.slice(0, 100))
    // Return just the current message — the agent will still respond,
    // just without conversation history context
  }
  const msgs: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []
  for (const m of priorMessages) {
    if (m.role === 'user') {
      let content = m.content
      const atts = m.attachments ? (JSON.parse(m.attachments) as AttachmentMeta[]) : []
      const textFiles = atts.filter((a) => a.textContent)
      const images = atts.filter((a) => a.mimeType.startsWith('image/'))
      if (textFiles.length) {
        content +=
          '\n\n[ATTACHED TEXT FILES]\n' +
          textFiles.map((a) => `--- ${a.originalName} ---\n${a.textContent?.slice(0, 8000)}`).join('\n\n')
      }
      if (images.length) {
        content += `\n\n[ATTACHED IMAGES: ${images.map((a) => a.originalName).join(', ')}] Use the vision tool with image_index to analyze them.`
      }
      msgs.push({ role: 'user', content })
    } else if (m.role === 'assistant') {
      msgs.push({ role: 'assistant', content: m.content })
    } else if (m.role === 'tool') {
      msgs.push({
        role: 'user',
        content: `[TOOL_RESULT] ${m.toolName}: ${m.toolResult ?? ''}`,
      })
    } else if (m.role === 'thought') {
      // skip — thoughts are internal; we re-feed them via assistant content's <thought> tags
    }
  }
  // current message
  let userContent = currentUserMessage
  const textFiles = currentAttachments.filter((a) => a.textContent)
  const images = currentAttachments.filter((a) => a.mimeType.startsWith('image/'))
  if (textFiles.length) {
    userContent +=
      '\n\n[ATTACHED TEXT FILES]\n' +
      textFiles.map((a) => `--- ${a.originalName} ---\n${a.textContent?.slice(0, 8000)}`).join('\n\n')
  }
  if (images.length) {
    userContent += `\n\n[ATTACHED IMAGES: ${images.map((a) => a.originalName).join(', ')}] Use the vision tool with image_index to analyze them.`
  }
  msgs.push({ role: 'user', content: userContent })

  // Auto-truncate if too long — keep the most recent ~30k tokens of history
  // and add a marker so the model knows earlier context was dropped.
  const MAX_TOKENS = 50_000
  const KEEP_TOKENS = 30_000
  if (estimateTokens(msgs) > MAX_TOKENS) {
    // Walk from the end of msgs, accumulating until we hit KEEP_TOKENS budget
    let keptTokens = 0
    let cutIndex = msgs.length
    for (let i = msgs.length - 1; i >= 0; i--) {
      const t = Math.ceil((msgs[i].content ?? '').length / 4)
      if (keptTokens + t > KEEP_TOKENS * 4) {
        cutIndex = i + 1
        break
      }
      keptTokens += t
      cutIndex = i
    }
    const trimmed = msgs.slice(cutIndex)
    return [
      {
        role: 'user',
        content:
          '[Earlier conversation history truncated to fit context window. Earlier tool results and assistant messages were dropped.]',
      },
      ...trimmed,
    ]
  }

  return msgs
}


export function chunkText(text: string, size: number): string[] {
  if (!text) return []
  const out: string[] = []
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size))
  return out
}

/**
 * Convert a raw LLM API exception into a friendly, user-visible message.
 * Detects rate-limit (429) errors specifically and produces a clear, actionable
 * message instead of dumping the raw API JSON.
 */
export function friendlyLlmError(e: any): string {
  const raw: string = e?.message ?? String(e)
  const status: number | undefined = e?.status ?? e?.response?.status
  const lower = raw.toLowerCase()

  // UPGRADE #149 (Fix #2) — Surface the full failure breakdown when available.
  // The new callLlmWithRetry attaches _failures, _allRateLimited, _rateLimitCount,
  // and _nonRateLimitCount to the thrown error. Use these to build a precise
  // message instead of guessing based on the last error's text.
  const failures: Array<{ provider: string; error: any; isRateLimit: boolean }> | undefined = (e as any)?._failures
  const allRateLimited: boolean | undefined = (e as any)?._allRateLimited
  const rateLimitCount: number | undefined = (e as any)?._rateLimitCount
  const nonRateLimitCount: number | undefined = (e as any)?._nonRateLimitCount

  if (failures && failures.length > 0) {
    const failureBreakdown = failures.map(f =>
      `${f.provider}: ${f.isRateLimit ? '429 (rate limit)' : (f.error?.message ?? 'unknown').slice(0, 80)}`
    ).join('\n  • ')

    if (allRateLimited) {
      return `⏳ All ${failures.length} LLM provider(s) returned HTTP 429 (rate limit).

This is a genuine rate-limit cascade — every provider is simultaneously at capacity.

Providers tried (in order):
  • ${failureBreakdown}

TO FIX:
1. Wait 60 seconds for the rate limits to reset
2. If this happens frequently, enable parallel-race mode: set LLM_PARALLEL_RACE=true in Vercel env vars (fires 3 providers at once, uses first success)
3. Check /api/health/llm-providers to see which providers are configured
4. Consider adding more providers (Cerebras, Brave AI) for more headroom`
    }

    return `⚠️ LLM providers failed (${rateLimitCount ?? 0} rate-limited, ${nonRateLimitCount ?? 0} other errors).

Not all failures were rate limits — this is likely a transient network/provider issue, not a capacity problem.

Providers tried (in order):
  • ${failureBreakdown}

TO FIX:
1. Click Retry — most transient failures clear in 5-10 seconds
2. Check /api/health/llm-providers to see which providers are configured
3. If one provider keeps failing, the circuit breaker will auto-skip it for 60s after 3 failures`
    }

  // Detect which provider failed (legacy fallback for non-upgraded callers)
  const isOpenai = lower.includes('openai') || lower.includes('fallback') || lower.includes('gpt-4o')
  const isZai = lower.includes('z-ai') || lower.includes('zai') || lower.includes('glm')
  const providerName = isOpenai ? 'OpenAI' : isZai ? 'Z.ai (GLM)' : 'AI provider'

  if (status === 429 || lower.includes('429') || lower.includes('too many requests')) {
    return `⏳ Agent007's ${providerName} is temporarily at capacity. Please wait 30 seconds and try again.`
  }
  if (status === 401 || status === 403 || lower.includes('unauthorized') || lower.includes('forbidden')) {
    // Check for region block specifically
    if (lower.includes('unsupported_country_region_territory') || lower.includes('region') && lower.includes('not supported')) {
      return `🌍 Agent007's ${providerName} is blocked in this server region.

The API key is VALID, but ${providerName} refuses to serve requests from this geographic location.

WHICH PROVIDER FAILED: ${providerName}
HTTP STATUS: ${status}

TO FIX:
1. Deploy to Vercel (US servers) — ${providerName} works there
2. Use Z.ai SDK as primary (already working in dev)
3. The key itself is fine — no need to change it

Agent007 is still functional via Z.ai SDK (GLM-4-Plus).`
    }
    return `🔐 Agent007's ${providerName} rejected the request (auth/permission).

This means the API key is invalid, expired, or doesn't have permission.

WHICH PROVIDER FAILED: ${providerName}
HTTP STATUS: ${status ?? 'unknown'}

TO FIX:
${isOpenai
      ? '1. Check your OpenAI API key is valid at https://platform.openai.com/api-keys\n2. Ensure you have credits at https://platform.openai.com/account/billing\n3. Update the key in Settings → API Key Manager\n4. Or set OPENAI_API_KEY as a Vercel env var'
      : '1. The Z.ai SDK may have a temporary auth issue\n2. Add an OPENAI_API_KEY as fallback in Settings → API Key Manager\n3. Or set OPENAI_API_KEY as a Vercel env var'}

The operator has been notified. Please contact ${OWNER_EMAIL} if this persists.`
  }
  if (status === 500 || status === 502 || status === 503 || lower.includes('server error') || lower.includes('service unavailable')) {
    return `🛠️ Agent007's ${providerName} is having a server-side issue (HTTP ${status}). Please retry in a moment.`
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return `⏱️ Agent007's ${providerName} took too long to respond. Please try again.`
  }
  return `⚠️ ${raw.slice(0, 200)}

This may be a temporary issue. Try again, or if it persists, add an OPENAI_API_KEY in Settings → API Keys.`
}
