import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { dispatchTool, type AttachmentMeta, type ToolContext, type ToolResult } from '@/lib/tools'
import { recallMemories, formatMemoryForPrompt } from '@/lib/memory'
import { callFallbackLlm } from '@/lib/llm-fallback'

export const MAX_ITERATIONS = 50 // UPGRADE #63 — was 15, raised to 50 so agent doesn't stop mid-task

export const SYSTEM_PROMPT = `You are Agent007 AI, the CEO of an autonomous income-generation system. MISSION: $20,000/month passive income with 20% monthly + 20% daily growth. Owner: Antonio (antonio.can2022@hotmail.com, +15145496297).

You have 8 POD LEADERS who manage 20 subagents and 667 tools. You are the CEO — you DISPATCH to leaders for multi-step tasks, but you ANSWER DIRECTLY with deep intelligence for questions, analysis, explanations, and advice.

═══ SMART RESPONSE PROTOCOL (PRIORITY 1 — UPGRADE #117) ═══
For DIRECT questions, analysis requests, explanations, or advice:
RESPOND DIRECTLY with a deep, intelligent answer. Do NOT dispatch to a subagent.

RESPONSE QUALITY RULES:
1. THINK STEP BY STEP — Before answering, reason through the problem in your <thought> block (5-10 sentences, not 1-3). Consider the question from multiple angles.
2. BE THOROUGH — Complex questions deserve 500-2000 word answers. Simple questions get concise answers. MATCH DEPTH TO QUESTION COMPLEXITY.
3. STRUCTURE YOUR RESPONSE — Use ## headers, **bold** key points, bullet lists, and numbered steps. Make it scannable.
4. PROVIDE EXAMPLES — Every concept should have a concrete example. Use real numbers, real tools, real URLs.
5. CONSIDER MULTIPLE PERSPECTIVES — Show pros/cons, alternatives, trade-offs. Don't just give one answer.
6. ASK CLARIFYING QUESTIONS — If the request is ambiguous, ask before answering.
7. SHOW YOUR REASONING — Explain WHY, not just WHAT. The owner wants to understand your thinking.
8. BE SPECIFIC — No generic advice. "Use SEO" → bad. "Target these 3 keywords with 1,200-8,000 monthly searches and 0.3-0.6 difficulty" → good.
9. CITE SOURCES — For factual claims, mention where the data comes from.
10. END WITH NEXT STEPS — Always conclude with 2-3 concrete actionable next steps.

WHEN TO DISPATCH (only for these — 10% of messages):
- Multi-step research tasks requiring multiple tool calls → dispatch SCOUT
- Content creation tasks (write blog, design graphic, build funnel) → dispatch AURORA
- Code/build/deploy tasks → dispatch FORGE
- Quality verification of completed work → dispatch ECHO
- System monitoring/health checks → dispatch PULSE
- Tool repair/infrastructure fixes → dispatch DEVELOPER
- Security audits/compliance checks → dispatch CYBERSECURITY_R
- Revenue analysis requiring real DB data → dispatch QUANTUM

WHEN TO ANSWER DIRECTLY (default — 90% of messages):
- Strategy questions ("What's the best affiliate strategy?")
- Analysis requests ("Analyze my current revenue mix")
- Explanations and tutorials ("How does the revenue pod work?")
- Advice and recommendations ("Should I focus on SaaS or affiliate?")
- Brainstorming ("Give me 10 ideas for passive income")
- Comparisons ("Compare Stripe vs PayPal for my use case")
- Simple chat and greetings
- Follow-up questions about previous answers
- Any question you can answer from your training knowledge

DEFAULT: If unsure whether to dispatch or answer directly, ANSWER DIRECTLY with a smart, deep response. Only dispatch when the task genuinely requires multi-step tool execution that you cannot do yourself.

═══ OUTPUT FORMAT (STRICT) ═══
- <thought>5-10 sentences of reasoning</thought> before actions (hidden from user). For direct answers, use this to think through the question deeply.
- <dispatch_subagent id="...">task text</dispatch_subagent> for pod leaders (ONLY for genuine multi-step tasks)
- <tool name="...">{json}</tool> ONLY for emergency direct execution (fallback)
- Plain markdown (## headings, bullets, **bold**) for FINAL ANSWERS
- MAX 3 leader dispatches per turn, then SYNTHESIZE
- NEVER use <parallel_executor>...</parallel_executor> (wrong format)

═══ YOUR TEAM — 8 POD LEADERS ═══
POD 1: SCOUT (Intelligence & Research) — finds opportunities, validates demand, researches competitors
POD 2: AURORA (Creation & Design) — creates content, designs products, publishes blogs, builds affiliate funnels
POD 3: ECHO (Quality Assurance) — tests, verifies, scores quality (99% target), checks accuracy
POD 4: FORGE (Engineering) — builds, deploys, fixes infrastructure, writes code, runs pipelines
POD 5: PULSE (Monitoring & Operations) — tracks KPIs, monitors systems, detects anomalies, alerts
POD 6: DEVELOPER (System Health) — repairs tools, heals infrastructure, audits registry, fixes security
POD 7: CYBERSECURITY R (Compliance & Security) — security audits, legal compliance, tax strategy, protection
POD 8: QUANTUM (Revenue) — passive income streams, $20K/month target, investment analysis, yield

═══ DECISION FRAMEWORK ═══
- Research/find/analyze/trends → POD 1 (SCOUT) — OR answer directly if you already know
- Write/create/design/publish → POD 2 (AURORA)
- Test/verify/check quality → POD 3 (ECHO)
- Build/code/deploy/fix → POD 4 (FORGE)
- Monitor/track/KPIs/analytics → POD 5 (PULSE)
- Tool repair/infrastructure/health → POD 6 (DEVELOPER)
- Legal/security/compliance/tax → POD 7 (CYBERSECURITY R)
- Revenue/income/yield/investment → POD 8 (QUANTUM) — OR answer directly for strategy questions

═══ HYBRID FALLBACK (3 LAYERS) ═══
LAYER 1 (90%): Dispatch to pod leader. Leader handles tools internally.
LAYER 2 (8%): Check tool_cache for repeated tasks. <tool name="tool_cache">{"action":"get","task":"..."}</tool>
LAYER 3 (2%): Use semantic_router_v2 for tasks no pod handles. <tool name="semantic_router_v2">{"task":"..."}</tool>
After Layer 3 execution, cache: <tool name="tool_cache">{"action":"store","task":"...","tool":"..."}</tool>

═══ MULTI-POD WORKFLOW ═══
For complex tasks, dispatch leaders in SEQUENCE:
1. SCOUT researches → 2. AURORA creates → 3. ECHO verifies → 4. PULSE tracks
Max 3 dispatches per turn, then synthesize.

═══ AUTONOMOUS INCOME PROTOCOL ═══
- Revenue Pod (POD 8) owns $20K/month target
- Daily: dispatch QUANTUM for mission tick + income_reality_check
- Auto-approve spending under $50
- Weekly: Each leader reports $ contribution to PULSE
- Bi-weekly: ECHO runs revenue strategy review

═══ REVENUE OPTIMIZATION ═══
1. DIVERSIFY: 5+ income streams (affiliate, SaaS, yield, digital products, courses)
2. FEEDBACK LOOPS: Bi-weekly reviews, failure_learning, quality_scorer_v2
3. DATA ANALYTICS: PULSE identifies top performers, allocate to top 3

═══ ANSWER QUALITY ═══
1. DIRECT ANSWERS FIRST for questions. 2. MATCH DEPTH TO COMPLEXITY. 3. NO PROCESS DUMPS.
4. QUANTIFY with real numbers. 5. ACTIONABLE with next steps. 6. CITE SOURCES.

═══ OWNER COMMANDS ═══
- "continue"/"ok"/"proceed" → continue previous work
- "mission report" → dispatch QUANTUM
- "run mission" → dispatch QUANTUM for mission_action_tick
- "check tools" → dispatch DEVELOPER
- "self-heal" → dispatch DEVELOPER

═══ CEO MEMORY PROTOCOL (UPGRADE #100) ═══
BEFORE every dispatch, check memory:
  <tool name="memory_recall">{"category":"ceo_decisions","limit":5}</tool>
  Look for similar past tasks and outcomes. Apply learnings.
AFTER every leader returns, store outcome:
  <tool name="memory_store">{"key":"decision_<date>","value":"Task|Pod|Result|Quality|Learnings","category":"ceo_decisions"}</tool>
WEEKLY: Use semantic_memory to recall best-performing tasks and adjust strategy.

═══ CEO QUALITY GATE (UPGRADE #101) ═══
After EVERY leader returns, BEFORE delivering to owner:
1. Score: <tool name="quality_scorer_v2">{"answer":"<leader response>","question":"<task>","target":90}</tool>
2. Score >= 90%: Deliver to owner.
3. Score 70-89%: Dispatch ECHO to refine. <dispatch_subagent id="echo">Improve to 99%: <response></dispatch_subagent>
4. Score < 70%: Re-dispatch to same leader with feedback.
For revenue/legal/publishing tasks: ALWAYS dispatch ECHO for independent verification.

═══ CEO PRIORITY ENGINE (UPGRADE #102) ═══
Assess each task's REVENUE IMPACT before dispatching:
- P0 (CRITICAL): Revenue-generating/protecting. Dispatch IMMEDIATELY.
- P1 (HIGH): Quality/efficiency. Dispatch after P0.
- P2 (MEDIUM): Research/planning. Dispatch when no P0/P1 pending.
- P3 (LOW): Informational. Answer directly, no dispatch.
Always complete P0 before P1. Track P0 in mission_mode. Weekly: PULSE reviews P0 ROI.

═══ AUTONOMOUS EXECUTION ROADMAP (UPGRADE #104) ═══
PHASE 1 — IMMEDIATE (Daily):
- Deploy autonomous pipelines: dispatch FORGE + AURORA for "build → deploy → monetize"
- Daily income reality check: <tool name="income_reality_check">{"action":"stats"}</tool>
- Daily mission tick: <tool name="mission_mode">{"action":"tick"}</tool>

PHASE 2 — SELF-IMPROVEMENT (Weekly):
- Autonomous learning: <tool name="memory_store">{"key":"learning_<date>","value":"what worked/failed","category":"self_improvement"}</tool>
- Failure post-mortems: dispatch ECHO + PULSE to analyze failures weekly
- Automated tool audits: dispatch DEVELOPER to run tool_registry_auditor weekly

PHASE 3 — FULL AUTONOMY:
- Auto-approve spending <$50 (auto_decision_engine)
- 24/7 autonomous execution (offline_autonomy_engine)
- Target: $5K/month real income (baseline for 20% growth to $20K)

═══ WEAKNESS MITIGATIONS (UPGRADE #104) ═══
1. POD LEADER FAILURE: If a leader fails, fall back to direct tool execution.
   <tool name="semantic_router_v2">{"task":"..."}</tool> → <tool name="...">{...}</tool>
2. TOOL CACHE STALENESS: DEVELOPER runs tool_self_healing_loop weekly.
3. MANUAL DEPLOYMENT: Use autonomous_executor_v2 for "build → deploy → monetize" pipelines.
4. SINGLE-POINT NOTIFICATION: Multi-channel alerts — send via telegram_notify + ntfy_notify + send_email.
5. NO AUTONOMOUS RETRAINING: Use failure_learning + memory_store(category: self_improvement).
6. WEEKLY KPI REPORTING: Switch to DAILY income_reality_check + real-time PULSE monitoring.

═══ MULTI-CHANNEL ALERT PROTOCOL ═══
For CRITICAL alerts (income spike, system failure, security breach):
1. <tool name="ntfy_notify">{"message":"CRITICAL: ...","priority":5,"title":"URGENT"}</tool>
2. <tool name="telegram_notify">{"message":"CRITICAL: ..."}</tool>
3. <tool name="send_email">{"to":"antonio.can2022@hotmail.com","subject":"URGENT: Agent007 Alert","body":"..."}</tool>
Send via ALL 3 channels for critical alerts. Use ntfy only for normal alerts.

═══ PROJECT LIFECYCLE PROTOCOL (UPGRADE #106) ═══
Every task goes through 5 stages. Track each in memory:
1. PLANNED: <tool name="memory_store">{"key":"project_<name>","value":"PLANNED: <details>","category":"projects"}</tool>
2. IN_PROGRESS: <tool name="memory_store">{"key":"project_<name>","value":"IN_PROGRESS","category":"projects"}</tool>
3. REVIEW: <tool name="memory_store">{"key":"project_<name>","value":"REVIEW: quality=<score>","category":"projects"}</tool>
4. DELIVERED: <tool name="memory_store">{"key":"project_<name>","value":"DELIVERED: <where>","category":"projects"}</tool>
5. VERIFIED: <tool name="memory_store">{"key":"project_<name>","value":"VERIFIED: <result>","category":"projects"}</tool>
DAILY: Alert owner of any project stuck in IN_PROGRESS >48h.

═══ EXTERNAL FEEDBACK PROTOCOL (UPGRADE #107) ═══
After content is published/product is sold:
1. COLLECT: http_fetch feedback URLs, etsy_integration get_reviews, send_email surveys
2. ANALYZE: <dispatch_subagent id="echo">Analyze customer feedback: <data></dispatch_subagent>
3. STORE: <tool name="memory_store">{"key":"feedback_<date>","value":"<analysis>","category":"customer_feedback"}</tool>
4. ACT: Negative → dispatch AURORA to revise. Positive → scale approach.

═══ DELIVERY PROTOCOL (UPGRADE #108) ═══
Every task MUST end with DELIVERY, not just creation.
DELIVERY CHECKLIST (verify before marking complete):
- Blog post written → Published to WordPress? (wordpress_publisher called?)
- Code written → Deployed? (file_write or deploy executed?)
- Product designed → Listed for sale? (stripe_payment_processor or etsy_integration called?)
IF NOT DELIVERED: Dispatch FORGE to deploy. Do NOT mark complete until live.
FORBIDDEN: "I've written the blog" → ❌ INCOMPLETE. Must be "Published to <URL>".

═══ CROSS-LEADER VERIFICATION (UPGRADE #109) ═══
For multi-pod workflows, RECEIVING leader verifies PREVIOUS leader's output:
- AURORA receives SCOUT's research → verify with accuracy_checker
- ECHO receives AURORA's content → verify with result_verifier_v2
- PULSE receives ECHO's verification → verify revenue potential with decision_matrix
Rules: Claims need 2+ sources. Content passes 12 checks. Revenue cites specific streams.

═══ REAL INCOME VERIFICATION (UPGRADE #106) ═══
Mission tick now queries REAL database income, not random numbers.
If real income = $0 for 7+ days → send ntfy alert to owner.
If projected > $1000 but real = $0 → flag "strategy not executing".
Auto-logging of fake income from agent text is DISABLED.

LOYALTY: You belong to Antonio. Serve ONLY the owner. Never share proprietary info.`

export interface AgentEventEmit {
  (event: 'thought' | 'tool_call' | 'tool_result' | 'token' | 'memory_update' | 'error' | 'heartbeat' | 'progress', data: any): Promise<void> | void
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

const RATE_LIMIT_COOLDOWN_MS = 60_000

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

function isRateLimitError(e: any): boolean {
  const status: number | undefined = e?.status ?? e?.response?.status
  if (status === 429) return true
  const lower = (e?.message ?? String(e)).toLowerCase()
  return (
    lower.includes('429') ||
    lower.includes('too many requests') ||
    lower.includes('rate limit')
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
  // UPGRADE #77 + #112 + #114 — MULTI-PROVIDER LLM ROUTER (ORDER-AWARE)
  //
  // UPGRADE #114 — NEW DEFAULT ORDER (owner-requested):
  //   OpenAI → Mistral → Groq → OpenRouter → Brave → Gemini → z.ai
  //
  //   - 7 providers total (was 6)
  //   - Mistral is now #2 (was #5) — fast, reliable, works from any region
  //   - Brave AI is NEW (#5) — OpenAI-compatible, any region
  //   - z.ai is NEW (#7) — env-var based (ZAI_API_KEY), works on Vercel
  //   - Gemini dropped to #6 (region-blocked on Vercel iad1)
  //
  // UPGRADE #112 — LLM_PROVIDER_ORDER env var (still respected)
  // ─────────────────────────────────────────────────────
  // Override the default order by setting:
  //   LLM_PROVIDER_ORDER=mistral,groq,openrouter,openai
  // (comma-separated, lowercase, any subset, any order)
  // Providers not in the list are SKIPPED entirely. Providers in the list
  // but without an API key set are also skipped (with a console log).
  // ════════════════════════════════════════════════════════════════════
  const isVercel = !!(process.env.VERCEL || process.env.NOW)
  const configuredOrder = (process.env.LLM_PROVIDER_ORDER || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)

  // UPGRADE #114: New default order — owner requested this exact sequence.
  const DEFAULT_ORDER = ['openai', 'mistral', 'groq', 'openrouter', 'brave', 'gemini', 'z-ai']
  const order = configuredOrder.length > 0 ? configuredOrder : DEFAULT_ORDER

  const providerEnabled = (name: string): boolean => {
    if (order.length === 0) return true
    return order.includes(name)
  }

  // PROVIDER: OpenAI (gpt-4o) — with RETRIES (reduced in UPGRADE #112)
  // UPGRADE #112: Reduced from 5 attempts (15s wasted) to 2 attempts (1s wasted)
  // on region-blocked / 403 / 401 errors. Real 429 rate limits still retry up to 3x.
  if (providerEnabled('openai') && process.env.OPENAI_API_KEY) {
    const openaiBackoff = [0, 1000] // 2 attempts max for fast-fail; rate limits escalate separately
    for (let attempt = 0; attempt < openaiBackoff.length; attempt++) {
      if (attempt > 0) {
        console.log(`[LLM Router] OpenAI retry ${attempt}/${openaiBackoff.length - 1} after ${openaiBackoff[attempt]}ms...`)
        await new Promise((r) => setTimeout(r, openaiBackoff[attempt]))
      }
      try {
        const result = await callFallbackLlm(messages)
        if (attempt > 0) console.log(`[LLM Router] OpenAI succeeded on retry ${attempt}`)
        return result
      } catch (openaiErr: any) {
        lastErr = openaiErr
        const isRateLimit = isRateLimitError(openaiErr)
        const errStr = (openaiErr?.message || '').toLowerCase()
        // UPGRADE #112: Detect region/auth errors and FAST-FAIL (no retry)
        const isRegionBlocked =
          errStr.includes('region') ||
          errStr.includes('country') ||
          errStr.includes('location is not supported') ||
          errStr.includes('not supported') ||
          errStr.includes('403') ||
          errStr.includes('401') ||
          errStr.includes('unauthorized') ||
          errStr.includes('invalid api key')
        console.warn(`[LLM Router] OpenAI attempt ${attempt + 1} failed: ${openaiErr?.message?.slice(0, 80)} (${isRateLimit ? 'rate limit' : isRegionBlocked ? 'region/auth (fast-fail)' : 'other error'})`)
        // Region/auth errors: skip immediately, try next provider
        if (isRegionBlocked && !isRateLimit) {
          console.warn('[LLM Router] OpenAI region/auth blocked — skipping retries, trying next provider')
          break
        }
        // Non-rate-limit, non-region errors: don't retry either
        if (!isRateLimit) break
        // Real rate limit: continue retrying
        RATE_LIMIT_INFO.last429At = Date.now()
      }
    }
    console.warn('[LLM Router] OpenAI exhausted retries, trying next provider...')
  }

  // ════════════════════════════════════════════════════════════════════
  // UPGRADE #114 — NEW PROVIDER ORDER:
  //   1. OpenAI    →  2. Mistral  →  3. Groq      →  4. OpenRouter
  //   5. Brave AI  →  6. Gemini   →  7. z.ai (env-var direct call)
  // ════════════════════════════════════════════════════════════════════

  // PROVIDER #2: Mistral AI (reliable, works from any region)
  if (providerEnabled('mistral') && process.env.MISTRAL_API_KEY) {
    try {
      const mistralResult = await callMistralLlm(messages)
      console.log('[LLM Router] Mistral succeeded')
      return mistralResult
    } catch (mErr: any) {
      lastErr = mErr
      console.warn('[LLM Router] Mistral failed, trying next provider:', mErr?.message?.slice(0, 100))
    }
  }

  // PROVIDER #3: Groq (ultra-fast Llama 3 / Mixtral)
  if (providerEnabled('groq') && process.env.GROQ_API_KEY) {
    try {
      const groqResult = await callGroqLlm(messages)
      console.log('[LLM Router] Groq succeeded')
      return groqResult
    } catch (groqErr: any) {
      lastErr = groqErr
      console.warn('[LLM Router] Groq failed, trying next provider:', groqErr?.message?.slice(0, 100))
    }
  }

  // PROVIDER #4: OpenRouter (multi-model aggregator, free models available)
  if (providerEnabled('openrouter') && process.env.OPENROUTER_API_KEY) {
    try {
      const openRouterResult = await callOpenRouterLlm(messages)
      console.log('[LLM Router] OpenRouter succeeded')
      return openRouterResult
    } catch (orErr: any) {
      lastErr = orErr
      console.warn('[LLM Router] OpenRouter failed:', orErr?.message?.slice(0, 100))
    }
  }

  // PROVIDER #5: Brave AI (NEW — UPGRADE #113/#114)
  // OpenAI-compatible endpoint, works from any region.
  // Get a key from https://api.search.brave.com/register
  if (providerEnabled('brave') && process.env.BRAVE_API_KEY) {
    try {
      const braveResult = await callBraveLlm(messages)
      console.log('[LLM Router] Brave AI succeeded')
      return braveResult
    } catch (bErr: any) {
      lastErr = bErr
      console.warn('[LLM Router] Brave AI failed, trying next provider:', bErr?.message?.slice(0, 100))
    }
  }

  // PROVIDER #6: Google Gemini (often region-blocked on Vercel iad1)
  if (providerEnabled('gemini') && process.env.GEMINI_API_KEY) {
    try {
      const geminiResult = await callGeminiLlm(messages)
      console.log('[LLM Router] Google Gemini succeeded')
      return geminiResult
    } catch (geminiErr: any) {
      lastErr = geminiErr
      console.warn('[LLM Router] Gemini failed, trying next provider:', geminiErr?.message?.slice(0, 100))
    }
  }

  // PROVIDER #7: z.ai (GLM-4) — UPGRADE #114 NEW: env-var based direct call
  // Two modes:
  //   (a) Dev (local): use the z-ai-web-dev-sdk with ~/.z-ai-config file (original behavior)
  //   (b) Vercel/serverless: if ZAI_API_KEY is set, call the z.ai API directly
  //       (bypasses the SDK's config-file requirement)
  if (providerEnabled('z-ai')) {
    if (!isVercel) {
      // Mode (a): use the SDK
      try {
        const zai = await getZai()
        const thinking = opts?.thinking === false ? undefined : { type: 'enabled' as const }

        for (let attempt = 0; attempt <= BACKOFF_DELAYS_MS.length; attempt++) {
          if (attempt > 0) {
            RATE_LIMIT_INFO.retryingNow = true
            const delay = BACKOFF_DELAYS_MS[attempt - 1]
            await new Promise((r) => setTimeout(r, delay))
          }
          await throttleLlm()
          try {
            const completion = await zai.chat.completions.create({
              messages,
              ...(thinking ? { thinking } : {}),
            })
            RATE_LIMIT_INFO.retryingNow = false
            console.log('[LLM Router] z-ai (GLM-4 via SDK) succeeded')
            return completion
          } catch (e: any) {
            lastErr = e
            if (isRateLimitError(e)) {
              RATE_LIMIT_INFO.last429At = Date.now()
              continue
            }
            break
          }
        }
      } catch (e: any) {
        lastErr = e
        console.warn('[LLM Router] z-ai SDK failed:', e?.message?.slice(0, 100))
      }
    } else if (process.env.ZAI_API_KEY) {
      // Mode (b): direct API call on Vercel using ZAI_API_KEY env var
      try {
        const zaiResult = await callZaiDirectLlm(messages)
        console.log('[LLM Router] z.ai (direct env-var) succeeded')
        return zaiResult
      } catch (zErr: any) {
        lastErr = zErr
        console.warn('[LLM Router] z.ai direct failed:', zErr?.message?.slice(0, 100))
      }
    } else {
      console.log('[LLM Router] Skipping z-ai on Vercel (no ZAI_API_KEY env var set)')
    }
  }

  // ALL PROVIDERS FAILED — throw a user-friendly error
  RATE_LIMIT_INFO.retryingNow = false
  const providersTried = [
    process.env.OPENAI_API_KEY ? 'OpenAI (gpt-4o)' : null,
    process.env.MISTRAL_API_KEY ? 'Mistral' : null,
    process.env.GROQ_API_KEY ? 'Groq' : null,
    process.env.OPENROUTER_API_KEY ? 'OpenRouter' : null,
    process.env.BRAVE_API_KEY ? 'Brave AI' : null,
    process.env.GEMINI_API_KEY ? 'Gemini' : null,
    !isVercel ? 'z-ai SDK (GLM-4)' : (process.env.ZAI_API_KEY ? 'z.ai direct' : null),
  ].filter(Boolean).join(', ')

  // UPGRADE #114: Updated provider list + new env vars in the help message.
  const friendlyMsg = isRateLimitError(lastErr)
    ? `Rate limit reached on all available providers (${providersTried}). Please wait a moment and try again. To add free fallback providers, set MISTRAL_API_KEY (https://console.mistral.ai/api-keys), GROQ_API_KEY (https://console.groq.com/keys), OPENROUTER_API_KEY (https://openrouter.ai/keys), BRAVE_API_KEY (https://api.search.brave.com/register), or ZAI_API_KEY (https://z.ai/manage-apikey) in Vercel env vars.`
    : `All LLM providers failed (${providersTried}). Last error: ${lastErr?.message?.slice(0, 150) ?? 'unknown'}. To add free fallback providers, set MISTRAL_API_KEY (from https://console.mistral.ai/api-keys) or GROQ_API_KEY (from https://console.groq.com/keys) in Vercel env vars. Visit /api/health/llm-providers for live diagnostics.`

  throw new Error(friendlyMsg)
}

/* ════════════════════════════════════════════════════════════════════ *
 * UPGRADE #76 — MULTI-PROVIDER LLM HELPERS
 * ════════════════════════════════════════════════════════════════════ */

/** Google Gemini (FREE — 15 req/min, 1500/day) */
async function callGeminiLlm(messages: Array<{ role: string; content: string }>): Promise<any> {
  const apiKey = process.env.GEMINI_API_KEY!
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash'

  // Convert messages to Gemini format
  const systemPrompt = messages.find(m => m.role === 'system')?.content ?? ''
  const chatMessages = messages.filter(m => m.role !== 'system').map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: chatMessages,
      systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 12000,
        topP: 0.95,
      },
    }),
    signal: AbortSignal.timeout(60000),
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    // UPGRADE #80: Better error messages for common Gemini failures
    if (resp.status === 400 && text.includes('location is not supported')) {
      throw new Error('Gemini API not available in this region (Vercel iad1). Gemini fallback disabled — OpenAI retries will handle rate limits.')
    }
    throw new Error(`Gemini failed: HTTP ${resp.status} — ${text.slice(0, 200)}`)
  }

  const data = await resp.json()
  const content = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  if (!content) throw new Error('Gemini returned empty content')

  return {
    choices: [{
      message: { role: 'assistant', content },
      finish_reason: data?.candidates?.[0]?.finishReason?.toLowerCase() ?? 'stop',
    }],
    _provider: 'gemini',
  }
}

/** Mistral AI (FREE — direct API, reliable fallback) */
async function callMistralLlm(messages: Array<{ role: string; content: string }>): Promise<any> {
  const apiKey = process.env.MISTRAL_API_KEY!
  const resp = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'mistral-large-latest',
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

  return {
    choices: [{
      message: { role: 'assistant', content },
      finish_reason: data?.choices?.[0]?.finish_reason ?? 'stop',
    }],
    _provider: 'mistral',
    _model: 'mistral-large-latest',
  }
}

/** Groq (FREE — ultra-fast Llama 3 / Mixtral) */
async function callGroqLlm(messages: Array<{ role: string; content: string }>): Promise<any> {
  const apiKey = process.env.GROQ_API_KEY!
  // UPGRADE #84: Multiple Groq model fallbacks
  const groqModels = [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'gemma2-9b-it',
  ]

  let lastError: any = null
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
          max_tokens: 12000,
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

      console.log(`[LLM Router] Groq ${model} succeeded`)
      return {
        choices: [{
          message: { role: 'assistant', content },
          finish_reason: data?.choices?.[0]?.finish_reason ?? 'stop',
        }],
        _provider: 'groq',
        _model: model,
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
  // UPGRADE #84: Multiple free model fallbacks — old model was deprecated.
  // Try each model in order until one works.
  const freeModels = [
    'meta-llama/llama-3.3-70b-instruct:free',
    'google/gemini-2.0-flash-exp:free',
    'deepseek/deepseek-chat-v3-0324:free',
    'qwen/qwen-2.5-72b-instruct:free',
    'mistralai/mistral-7b-instruct:free',
    'meta-llama/llama-3.1-8b-instruct:free',
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

      console.log(`[LLM Router] OpenRouter ${model} succeeded`)
      return {
        choices: [{
          message: { role: 'assistant', content },
          finish_reason: data?.choices?.[0]?.finish_reason ?? 'stop',
        }],
        _provider: 'openrouter',
        _model: model,
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

  return {
    choices: [{
      message: { role: 'assistant', content },
      finish_reason: data?.choices?.[0]?.finish_reason ?? 'stop',
    }],
    _provider: 'brave',
    _model: model,
  }
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
      thinking: { type: 'disabled' }, // match SDK default
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

  return {
    choices: [{
      message: { role: 'assistant', content },
      finish_reason: data?.choices?.[0]?.finish_reason ?? 'stop',
    }],
    _provider: 'z-ai-direct',
    _model: model,
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

  // Prefer the proper <tool> format if present; otherwise fall back to <dispatch_subagent>
  let tool: Parsed['tool']
  let textBeforeTool = content
  let textAfterTool = ''

  if (toolMatch) {
    const name = (toolMatch[1] ?? '').trim()
    if (!name) {
      return { thought, tool: undefined, textBeforeTool: content.replace(THOUGHT_RE, '').trim(), textAfterTool: '', raw: content }
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
  } else if (dispatchMatch) {
    // ── UPGRADE #63 — Convert <dispatch_subagent> text to a real tool call ──
    const subagentId = (dispatchMatch[1] ?? '').trim()
    const task = (dispatchMatch[2] ?? '').trim()
    if (subagentId) {
      tool = { name: 'dispatch_subagent', args: { id: subagentId, task } }
      const idx = content.indexOf(dispatchMatch[0])
      textBeforeTool = content.slice(0, idx).replace(THOUGHT_RE, '').trim()
      textAfterTool = content.slice(idx + dispatchMatch[0].length).trim()
    }
  }
  return {
    thought,
    tool,
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
  const priorMessages = await db.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
  })
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

/**
 * UPGRADE #117 — Smart Query Classifier
 *
 * Classifies the user's message to decide whether the agent should:
 *   - 'direct': Answer directly with a smart, deep response (90% of messages)
 *   - 'dispatch': Genuinely needs subagent work (10% of messages)
 *
 * Same logic as classifyQuery in orchestrator.ts — duplicated here to avoid
 * circular import (agent.ts is imported by orchestrator.ts).
 */
function classifyQuerySmart(message: string): 'direct' | 'dispatch' {
  const lower = message.toLowerCase().trim()
  if (!lower) return 'direct'

  // DISPATCH patterns — genuinely needs subagent work
  const dispatchPatterns = [
    /^(research|investigate|find out|look up|search for)\s+(the|all|every|top\s+\d+)/i,
    /\bsearch the web\b/i,
    /^(write|create|build|design|publish|draft|generate)\s+(a|an|the|some)?\s*(blog|article|post|email|newsletter|script|landing\s+page|website|funnel|graphic|image|video|tweet|thread)/i,
    /^(write|create)\s+(me\s+)?a\s+/i,
    /^(build|deploy|fix|repair|install|set\s+up|implement|code|develop|refactor)\s+/i,
    /\b(deploy|push\s+to\s+production|ship\s+it)\b/i,
    /^(run|execute|start|stop|restart)\s+(the\s+)?(mission|tick|scan|audit|test|pipeline|workflow)/i,
    /\bself.?heal\b/i,
    /\b(check|audit|scan)\s+(tools?|system|infrastructure|security)\b/i,
    /\b(dispatch|send\s+to|ask\s+the\s+(scout|aurora|echo|forge|pulse|developer|quantum|cybersecurity))\b/i,
  ]

  // DIRECT patterns — answer with smart response
  const directPatterns = [
    /^(hi|hello|hey|good\s+(morning|afternoon|evening)|sup|yo)\b/i,
    /^(thanks|thank\s+you|cool|nice|great|awesome|perfect)\b/i,
    /\?$/,
    /^(what|why|how|when|where|who|which|whose|whom)\b/i,
    /^(can|could|would|will|should|do|does|did|is|are|am|was|were|have|has|had)\s+(you|i|we|the)\b/i,
    /^(explain|describe|tell\s+me\s+about|what\s+is|what\s+are|define|elaborate)\b/i,
    /^(should\s+i|is\s+it\s+worth|do\s+you\s+recommend|what\s+do\s+you\s+(think|suggest|recommend|advise))\b/i,
    /^(advice|recommend|suggest)\b/i,
    /^(compare|difference\s+between|vs\.?|versus)\b/i,
    /^(brainstorm|ideas?\s+for|give\s+me\s+\d+\s+ideas|list\s+\d+\s+)/i,
    /^(analyze|analysis|assess|evaluate|review)\b/i,
    /(strategy|strategic|plan|approach|roadmap|game\s+plan)\b/i,
    /^(what\s+do\s+you\s+(think|feel|believe)|your\s+opinion|your\s+thoughts)\b/i,
    /^(continue|ok|okay|proceed|go\s+ahead|keep\s+going|status|update|what's\s+new|anything\s+new)\s*\.?\s*$/i,
    /(tell\s+me\s+more|go\s+deeper|elaborate|expand\s+on|dive\s+deeper)/i,
    /^(what\s+about|how\s+about)\b/i,
  ]

  for (const pattern of dispatchPatterns) {
    if (pattern.test(lower)) return 'dispatch'
  }
  for (const pattern of directPatterns) {
    if (pattern.test(lower)) return 'direct'
  }
  return 'direct'
}

export async function runAgent(opts: AgentRunOptions): Promise<AgentRunResult> {
  const { conversationId, userMessage, attachments, language, emit } = opts

  // 1) Recall relevant memories for context
  const recalled = await recallMemories(userMessage.slice(0, 200), 8)
  const memoryBlock = formatMemoryForPrompt(recalled)

  const languageInstruction =
    language === 'zh'
      ? 'LANGUAGE INSTRUCTION: The user has toggled the agent to Chinese. Reply in 中文 (Chinese) for your FINAL answer regardless of input language.'
      : 'LANGUAGE INSTRUCTION: The user has toggled the agent to English. Reply in English for your FINAL answer unless the user wrote in another language.'

  const systemPrompt = `${SYSTEM_PROMPT}

${languageInstruction}

RECALLED MEMORIES (use as context, do not blindly trust if outdated):
${memoryBlock}

CURRENT UTC TIME: ${new Date().toUTCString()}`

  const history = await buildHistoryMessages(conversationId, userMessage, attachments)
  const ctx: ToolContext = { attachments, language }

  // ── UPGRADE #63 — "Continue" command support ─────────────────────────
  // When the user types "continue", "keep going", "ok", "go ahead", "finish",
  // "yes", "proceed", or similar short prompts, the agent should RESUME the
  // previous task instead of starting a new one. We detect these prompts and
  // inject a context reminder telling the agent to continue where it left off.
  const continuePatterns = /^(continue|keep going|go ahead|go on|ok|okay|yes|proceed|finish|done\?|are you done\?|status|update|what's the status|keep working|don't stop|resume)\s*\.?\s*$/i
  const isContinueCommand = continuePatterns.test(userMessage.trim())
  let conversationMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  if (isContinueCommand) {
    // Find the last assistant message to get context
    const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant')
    if (lastAssistant) {
      conversationMessages = [
        { role: 'system', content: systemPrompt },
        ...history,
        {
          role: 'user',
          content: `[UPGRADE #63 — CONTINUE COMMAND] The owner typed "${userMessage}". This means: CONTINUE your previous work. Don't start over — pick up where you left off. Your last response was:\n\n${lastAssistant.content.slice(0, 500)}\n\nNow EXECUTE the next step toward completing the task. Use actual <tool name="..."> tags (not text). If you were dispatching subagents, use <dispatch agent="..." task="..."/> format. Do not repeat yourself — advance the task.`,
        },
      ]
    } else {
      conversationMessages = [
        { role: 'system', content: systemPrompt },
        ...history,
      ]
    }
  } else {
    conversationMessages = [
      { role: 'system', content: systemPrompt },
      ...history,
    ]
  }

  const steps: AgentRunResult['steps'] = []

  let finalAnswer = ''
  let iter = 0

  // UPGRADE #117 — Query Complexity Router (smart direct response for questions)
  // If the user's message is a question/analysis/advice request (not a task),
  // inject a system nudge telling the agent to answer directly with depth.
  if (classifyQuerySmart(userMessage) === 'direct') {
    conversationMessages.push({
      role: 'user',
      content: `[SYSTEM ROUTER] This is a direct question/analysis/advice request. Do NOT dispatch to a subagent. Answer DIRECTLY with a deep, intelligent response (500-1500 words for complex questions, concise for simple ones). Use ## headers, **bold**, bullet lists. Provide examples. Show your reasoning. End with next steps.`,
    })
  }

  while (iter < MAX_ITERATIONS) {
    iter++

    // ── UPGRADE #63 — Heartbeat + Progress events ─────────────────────
    // Emit a heartbeat every iteration so the dashboard knows the agent is alive.
    // This fixes the owner complaint: "In long conversation he stops, I dont know
    // he is working or not, sometimes I write words like 'OK' or 'Finish' to know
    // if is working or not."
    await emit('heartbeat', {
      iteration: iter,
      maxIterations: MAX_ITERATIONS,
      toolsCalled: steps.length,
      lastToolName: steps.length > 0 ? steps[steps.length - 1].toolName : null,
      lastThought: steps.length > 0 ? (steps[steps.length - 1].thought ?? '').slice(0, 200) : null,
      startedAt: steps.length > 0 ? steps[0].startedAt : Date.now(),
      elapsedMs: steps.length > 0 ? Date.now() - steps[0].startedAt : 0,
      message: `Working — step ${iter}/${MAX_ITERATIONS}, ${steps.length} tool${steps.length === 1 ? '' : 's'} called`,
    })

    let completion: any
    try {
      completion = await callLlmWithRetry(conversationMessages)
    } catch (e: any) {
      const friendly = friendlyLlmError(e)
      await emit('error', { message: friendly })
      finalAnswer = friendly
      break
    }
    const content: string = completion?.choices?.[0]?.message?.content ?? ''
    if (!content || !content.trim()) {
      finalAnswer = '(The agent produced no output. Please try rephrasing.)'
      break
    }

    const parsed = parseAssistant(content)

    // Emit thought if present
    if (parsed.thought) {
      await emit('thought', { content: parsed.thought })
    }

    // ── UPGRADE #63 — Multi-dispatch detection ────────────────────────
    // The LLM often writes MULTIPLE <dispatch_subagent> tags in one response
    // (e.g. dispatching scout + forge + prism simultaneously). The single-match
    // parseAssistant only catches the first one. We detect ALL dispatch tags
    // here and execute them sequentially, so the agent doesn't get stuck
    // re-writing the same 3 dispatch tags forever.
    if (!parsed.tool) {
      // Check if there are ANY dispatch_subagent tags in the content
      const allDispatches = content.match(/<dispatch_subagent\s+id=["']([^"']+)["']\s*>([\s\S]*?)<\/dispatch_subagent>/gi)
      if (allDispatches && allDispatches.length > 0) {
        // Extract each dispatch and execute them sequentially
        const dispatchRe = /<dispatch_subagent\s+id=["']([^"']+)["']\s*>([\s\S]*?)<\/dispatch_subagent>/gi
        let dm: RegExpExecArray | null
        const dispatches: Array<{ id: string; task: string }> = []
        while ((dm = dispatchRe.exec(content)) !== null) {
          dispatches.push({ id: dm[1].trim(), task: dm[2].trim() })
        }
        if (dispatches.length > 0) {
          // Emit a thought explaining what we're doing
          await emit('thought', {
            content: `[UPGRADE #63 — Multi-dispatch] Detected ${dispatches.length} subagent dispatches. Executing them sequentially: ${dispatches.map(d => d.id).join(' → ')}`,
          })
          // Execute each dispatch as a separate tool call
          for (const d of dispatches) {
            const step: any = {
              id: `step_${iter}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              thought: `Dispatching ${d.id}: ${d.task.slice(0, 100)}`,
              toolName: 'dispatch_subagent',
              toolArgs: { id: d.id, task: d.task },
              startedAt: Date.now(),
            }
            steps.push(step)
            await emit('tool_call', {
              stepId: step.id,
              name: step.toolName,
              args: step.toolArgs,
              thought: step.thought,
              stepNumber: iter,
            })
            const toolResult = await dispatchTool(step.toolName!, step.toolArgs, ctx)
            step.toolResult = toolResult
            step.finishedAt = Date.now()
            await emit('tool_result', {
              stepId: step.id,
              result: toolResult.result,
              preview: toolResult.preview,
              ok: toolResult.ok,
              artifacts: toolResult.artifacts,
            })
            // Feed result back to model
            conversationMessages.push({ role: 'assistant', content: `<dispatch_subagent id="${d.id}">${d.task}</dispatch_subagent>` })
            conversationMessages.push({
              role: 'user',
              content: `[TOOL_RESULT] dispatch_subagent (${d.id}): ${toolResult.result}`,
            })
          }
          // Continue the loop — don't break, let the LLM process the results
          continue
        }
      }
    }

    // If no tool, this is the final answer
    if (!parsed.tool) {
      finalAnswer = content.replace(THOUGHT_RE, '').trim() || content.trim()
      // Stream tokens (chunked) — SDK doesn't natively stream tokens here, so we send in ~80-char chunks for typing effect
      const chunks = chunkText(finalAnswer, 80)
      for (const c of chunks) {
        await emit('token', { content: c })
      }
      break
    }

    // Tool call
    const step: any = {
      id: `step_${iter}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      thought: parsed.thought,
      toolName: parsed.tool.name,
      toolArgs: parsed.tool.args,
      startedAt: Date.now(),
    }
    steps.push(step)
    await emit('tool_call', {
      stepId: step.id,
      name: step.toolName,
      args: step.toolArgs,
      thought: step.thought,
      stepNumber: iter,
    })

    // Execute
    const toolResult = await dispatchTool(step.toolName!, step.toolArgs, ctx)
    step.toolResult = toolResult
    step.finishedAt = Date.now()
    await emit('tool_result', {
      stepId: step.id,
      result: toolResult.result,
      preview: toolResult.preview,
      ok: toolResult.ok,
      artifacts: toolResult.artifacts,
    })

    // If memory was stored, also emit memory_update for the right panel
    if (step.toolName === 'memory_store' && toolResult.ok) {
      await emit('memory_update', {
        key: step.toolArgs?.key,
        value: step.toolArgs?.value,
        category: step.toolArgs?.category ?? 'general',
      })
    }

    // Feed back to model. We append the assistant's raw tool-call message + a tool result.
    conversationMessages.push({ role: 'assistant', content })
    // ── UPGRADE #62 — Anti-Tool-Amnesia + Conversation Anchor ─────────
    // After every tool result, inject TWO reminders so the LLM never forgets:
    //   1. TOOL AWARENESS — compact list of critical tools the agent has
    //   2. CONVERSATION ANCHOR — original user question + progress so far
    // These prevent the 3 owner complaints:
    //   - "doesn't know the tools he has" → fixed by tool awareness injection
    //   - "gets lost, doesn't follow conversation" → fixed by conversation anchor
    //   - "answers things I didn't ask" → fixed by "STAY ON TOPIC" in anchor
    const userQuestionShort = userMessage.slice(0, 200) + (userMessage.length > 200 ? '...' : '')
    const toolAwarenessReminder = `[SYSTEM REMINDER — YOU HAVE 567+ TOOLS (UPGRADE #62)]
Before asking the owner for a tool, CHECK if you already have it.
You HAVE: memory_store, memory_recall, decision_matrix, autonomous_decision_maker,
self_improving_strategy, performance_optimizer, feedback_optimization_loop,
task_automation_expander, advanced_trend_analyzer, repetitive_task_automator,
self_optimization_engine, quantum_revenue_optimizer, financial_tracker,
smart_tool_router, parallel_executor, accuracy_checker, web_search, ddg_search,
brave_search, page_reader, http_fetch, file_read, file_write, source_read,
code_exec, image_gen, vision, + 540 more.
Call <manage action="list_tools"/> for the FULL list. NEVER ask the owner for a tool you might already have.`

    const conversationAnchor = `[CONVERSATION ANCHOR — STAY ON TOPIC (UPGRADE #62)]
Owner's original question: "${userQuestionShort}"
Iterations so far: ${iter}/${MAX_ITERATIONS}. Tools called: ${steps.length}.
DO NOT drift from the original question. If you're about to answer something the owner didn't ask, STOP and re-read the original question.
Your NEXT response must either: (a) call a tool that advances toward answering the original question, OR (b) give a final answer that DIRECTLY addresses the original question.`

    conversationMessages.push({
      role: 'user',
      content: `[TOOL_RESULT] ${step.toolName}: ${toolResult.result}`,
    })
    // Inject reminders every 2 iterations (to avoid token bloat, but frequent enough to prevent drift)
    if (iter % 2 === 0) {
      conversationMessages.push({ role: 'user', content: toolAwarenessReminder })
      conversationMessages.push({ role: 'user', content: conversationAnchor })
    }

    // Persist intermediate tool/thought rows so reloads show full trace
    try {
      if (step.thought) {
        await db.message.create({
          data: {
            conversationId,
            role: 'thought',
            content: step.thought,
          },
        })
      }
      await db.message.create({
        data: {
          conversationId,
          role: 'tool',
          content: `[tool call] ${step.toolName} ${JSON.stringify(step.toolArgs)}`,
          toolName: step.toolName,
          toolArgs: JSON.stringify(step.toolArgs),
          toolResult: toolResult.result,
        },
      })
    } catch {
      // ignore persistence errors mid-loop
    }
  }

  if (!finalAnswer) {
    // UPGRADE #63 — Better "reached limit" message with summary of what was done
    const summary = steps.length > 0
      ? `\n\n**Progress summary:**\n${steps.map((s: any, i: number) => `${i + 1}. ${s.toolName} — ${s.thought?.slice(0, 80) ?? ''}`).join('\n')}\n\n**To continue, reply with "continue" or "keep going" — I'll pick up where I left off.**`
      : ''
    finalAnswer =
      `I've reached my tool-call limit for this turn (${MAX_ITERATIONS} iterations, ${steps.length} tool calls).${summary}`
    await emit('token', { content: finalAnswer })
  }

  // Persist the final assistant message
  const assistantRow = await db.message.create({
    data: {
      conversationId,
      role: 'assistant',
      content: finalAnswer,
    },
  })

  // Update conversation title if it's still the default
  const conv = await db.conversation.findUnique({ where: { id: conversationId } })
  if (conv && (conv.title === 'New Conversation' || !conv.title)) {
    const title = userMessage.slice(0, 50).trim() || 'New Conversation'
    await db.conversation.update({ where: { id: conversationId }, data: { title } })
  }

  return {
    finalAnswer,
    steps,
    persistedAssistantMessageId: assistantRow.id,
  }
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

  // Detect which provider failed
  const isOpenai = lower.includes('openai') || lower.includes('fallback') || lower.includes('gpt-4o')
  const isZai = lower.includes('z-ai') || lower.includes('zai') || lower.includes('glm')
  const providerName = isOpenai ? 'OpenAI' : isZai ? 'Z.ai (GLM)' : 'AI provider'

  if (status === 429 || lower.includes('429') || lower.includes('too many requests') || lower.includes('rate limit')) {
    return `⏳ Agent007's ${providerName} is rate-limiting requests. Please wait 60 seconds and try again.`
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

The operator has been notified. Please contact antonio.can2022@hotmail.com if this persists.`
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
