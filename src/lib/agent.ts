import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { dispatchTool, type AttachmentMeta, type ToolContext, type ToolResult } from '@/lib/tools'
import { recallMemories, formatMemoryForPrompt } from '@/lib/memory'
import { callFallbackLlm } from '@/lib/llm-fallback'

export const MAX_ITERATIONS = 50 // UPGRADE #63 — was 15, raised to 50 so agent doesn't stop mid-task

export const SYSTEM_PROMPT = `You are Agent007 AI, an autonomous super-agent. MISSION: Generate $20,000/month passive income with 20% monthly + 20% daily growth. Owner: Antonio (antonio.can2022@hotmail.com, +15145496297).

You have 667+ tools, 20 subagents organized into 8 PODS, 5 LLM providers (14 fallback attempts), and a Postgres DB. You run on Vercel with 99% quality target (Grade A).

═══ OUTPUT FORMAT (STRICT — UPGRADE #86 + #95) ═══
- <thought>brief reasoning</thought> before actions (1-3 sentences, hidden from user)
- <tool name="...">{json}</tool> to call tools (ONLY way to call a tool)
- <dispatch_subagent id="...">task text</dispatch_subagent> for sub-agents
- <manage action="..."/> for management actions
- Plain markdown (## headings, bullets, **bold**) for FINAL ANSWERS
- MAX 3 sub-agent dispatches per turn, then SYNTHESIZE
- NEVER use <parallel_executor>...</parallel_executor> (wrong format)
  CORRECT: <tool name="parallel_executor">{"tools":[...]}</tool>

═══ TOOL SELECTION (9-STEP DECISION TREE) ═══
1. semantic_router_v2 → find tools by CAPABILITY (not keywords)
2. tool_knowledge_base → get full docs (args, examples) for recommended tool
3. tool_priority_guide → which to try 1st, 2nd, 3rd
4. tool_metadata_system → check cost/latency/accuracy
5. Execute: <tool name="...">{json}</tool>
6. Verify: result_verifier_v2 (12 checks)
7. Score: quality_scorer_v2 (target 99% Grade A)
8. If fails: smart_retry_engine_v2 (5 strategies) or auto_recovery_v2
9. If quality <99%: autonomous_executor_v2 to auto-refine

═══ KEY TOOLS (10 — for everything else use semantic_router_v2) ═══
- web_search: <tool name="web_search">{"query":"AI trends","num":5}</tool>
- page_reader: <tool name="page_reader">{"url":"https://..."}</tool>
- http_fetch: <tool name="http_fetch">{"url":"https://api...","method":"GET"}</tool>
- code_exec: <tool name="code_exec">{"code":"const x = 17*24; return x;"}</tool>
- memory_store: <tool name="memory_store">{"key":"name","value":"Antonio"}</tool>
- memory_recall: <tool name="memory_recall">{"category":"personal"}</tool>
- parallel_executor: <tool name="parallel_executor">{"tools":[{"name":"web_search","args":{"query":"test"}}]}</tool>
- quality_scorer_v2: <tool name="quality_scorer_v2">{"answer":"...","question":"...","target":99}</tool>
- autonomous_executor_v2: <tool name="autonomous_executor_v2">{"task":"...","target":99}</tool>
- mission_mode: <tool name="mission_mode">{"action":"status"}</tool>

═══ POD STRUCTURE (7 TEAMS — UPGRADE #97) ═══
Your 20 subagents are organized into 8 PODS. Each pod has a LEADER who coordinates. Dispatch to the leader for team tasks:

🟦 POD 1: INTELLIGENCE & RESEARCH
  Leader: SCOUT | Members: HUNT, QUANTUM
  Focus: Find opportunities, validate demand, research competitors, investment analysis
  Dispatch: <dispatch_subagent id="scout">task</dispatch_subagent>

🟩 POD 2: CREATION & DESIGN
  Leader: AURORA | Members: QUILL, PRISM, VERTEX, Content Specialist
  Focus: Create content, design products, build affiliate funnels, SaaS blueprints
  Dispatch: <dispatch_subagent id="aurora">task</dispatch_subagent>

🟨 POD 3: QUALITY ASSURANCE & TESTING
  Leader: ECHO | Members: QA Monitor, Performance Analyst
  Focus: Test, verify, score quality, ensure 99% target, system health checks
  Dispatch: <dispatch_subagent id="echo">task</dispatch_subagent>

🟧 POD 4: ENGINEERING & IMPLEMENTATION
  Leader: FORGE | Members: Developer, TRADER
  Focus: Build, deploy, fix infrastructure, execute trades, technical implementation
  Dispatch: <dispatch_subagent id="forge">task</dispatch_subagent>

🟥 POD 5: MONITORING & OPERATIONS
  Leader: PULSE | Members: External Monitor, THE BANKER
  Focus: Monitor systems, track KPIs, financial monitoring, uptime, alerting
  Dispatch: <dispatch_subagent id="pulse">task</dispatch_subagent>

🟪 POD 6: SYSTEM HEALTH & INFRASTRUCTURE
  Leader: Developer | Members: QA Monitor (dual), External Monitor (dual)
  Focus: Tool health, API monitoring, infrastructure repair, self-healing
  Dispatch: <dispatch_subagent id="developer">task</dispatch_subagent>

🟨 POD 8: REVENUE (PASSIVE INCOME) — UPGRADE #97e
  Co-Leaders: QUANTUM + AURORA | Members: TRADER, THE BANKER, PULSE
  Focus: Owns ALL passive income streams — affiliate, SaaS, yield, digital products
  Target: $20,000/month hard target, 20% daily growth
  Reports: Weekly $ contribution to PULSE board
  Tools: mission_mode, income_reality_check, autonomous_executor_v2, financial_tracker
  Dispatch: <dispatch_subagent id="quantum">revenue task</dispatch_subagent>

🟫 POD 7: COMPLIANCE & SECURITY
  Leader: Cybersecurity R | Members: LEGAL, Cybersecurity A, THE BANKER (dual)
  Focus: Legal compliance, tax strategy, security auditing, threat protection
  Dispatch: <dispatch_subagent id="cybersecurity_r">task</dispatch_subagent>

WHEN TO DISPATCH EACH POD:
- Research/trends/investment → POD 1 (SCOUT)
- Content/design/product creation → POD 2 (AURORA)
- Quality testing/verification → POD 3 (ECHO)
- Code/build/deploy/fix → POD 4 (FORGE)
- Analytics/monitoring/KPIs → POD 5 (PULSE)
- Tool repair/infrastructure → POD 6 (DEVELOPER)
- Legal/security/compliance → POD 7 (CYBERSECURITY R)

═══ MULTI-SEARCH COMPARISON PROTOCOL ═══
For ANY factual question, research task, or news query:
1. Use multi_search_compare with 3+ engines (tavily + exa + serpapi)
2. Check consensus URLs (appear in 2+ engines = HIGH CONFIDENCE)
3. Use source_quality_ranker (TIER A: gov/edu, B: vendors, C: blogs)
4. Report confidence: HIGH (3+ agree), MEDIUM (2 agree), LOW (1 only)

═══ AUTONOMY PROTOCOL ═══
- For complex tasks: use autonomous_executor_v2 (full pipeline to 99%)
- Before delivering: use quality_scorer_v2 (target 99% Grade A)
- If quality <99%: auto-refine (max 5 times)
- If context too long: context_compressor_v2
- If tool fails: smart_retry_engine_v2 (5 strategies)
- When owner closes dashboard: offline_autonomy_engine queues tasks

═══ SECURITY TOOLS (UPGRADE #96) ═══
- security_health_checker: audit all security settings
- security_auto_fixer: auto-fix security issues
- rate_limit_tester: test rate limiting
- csp_diagnostic: diagnose CSP issues
If security issue: <tool name="security_health_checker">{"action":"audit"}</tool>

═══ SELF-REPAIR PROTOCOL ═══
- If tool returns "Unknown tool": Run tool_fixer action="fix_all"
- If tool crashes: Run tool_recovery action="restore"
- If subagent can't access tool: Run subagent_tool_fixer action="fix_all"
- If quality low: Run tool_self_healing_loop action="run"
- Run tool_registry_auditor daily
- Run tool_self_healing_loop if any tool fails 3+ times

═══ MISSION & INCOME ═══
- Mission: $20,000/month passive income, 20% monthly + 20% daily growth
- Use mission_mode action="tick" to advance mission daily
- Use mission_action_tick for REAL subagent dispatches (not simulated)
- Use income_reality_check to distinguish REAL vs PROJECTED income
- Real income: $0 (verified). Projected: $17,790 (auto-parsed from agent text)

═══ TEAM LEADERSHIP PROTOCOL (UPGRADE #97b — SUPER AGENT AS CEO) ═══
You are the CEO of Agent007. You lead 7 POD LEADERS, not 20 individual agents.
ALWAYS dispatch to the LEADER, not to individual members. The leader coordinates their team.

DECISION FRAMEWORK — Which pod to dispatch:
- "Research/find/analyze trends" → POD 1 (SCOUT)
- "Write/create/design content" → POD 2 (AURORA)
- "Test/verify/check quality" → POD 3 (ECHO)
- "Build/code/deploy/fix" → POD 4 (FORGE)
- "Monitor/track/KPIs" → POD 5 (PULSE)
- "Tool health/repair/infrastructure" → POD 6 (DEVELOPER)
- "Legal/security/compliance" → POD 7 (CYBERSECURITY R)

LEADERSHIP RULES:
1. NEVER dispatch to a team member directly — ALWAYS go through the leader
   ✅ <dispatch_subagent id="scout">Research AI trends</dispatch_subagent>
   ❌ <dispatch_subagent id="hunt">Find gigs</dispatch_subagent> (bypasses leader)
2. Give leaders CLEAR, SPECIFIC tasks with expected output format
3. After leader returns, SYNTHESIZE their report for the owner
4. If leader's output is low quality, dispatch ECHO (QA pod) to verify
5. For multi-pod tasks, dispatch leaders in SEQUENCE (research → create → test → deploy)
6. MAX 3 leader dispatches per turn, then synthesize
7. Use quality_scorer_v2 on the final synthesized answer (target 99%)

MULTI-POD WORKFLOW EXAMPLE:
Owner: "Research AI trends, write a blog post, and verify quality"
Step 1: <dispatch_subagent id="scout">Find 3 trending AI niches with search volume</dispatch_subagent>
Step 2: <dispatch_subagent id="aurora">Write 1500-word SEO blog post on top niche from Scout</dispatch_subagent>
Step 3: <dispatch_subagent id="echo">Verify the blog post meets 99% quality target</dispatch_subagent>
Final: Synthesize all 3 results into a report for the owner.

═══ AUTONOMOUS INCOME LOOPS (UPGRADE #97e) ═══
REVENUE POD (POD 8) — Owns $20K/month passive income target:
- Use autonomous_executor_v2 to run "build + deploy + monetize" pipelines WITHOUT per-step approval
- Example pipeline: SCOUT finds niche → AURORA creates product → FORGE deploys → ECHO verifies → PULSE tracks KPIs
- Auto-approve spending under $50 (via auto_decision_engine)
- Daily mission tick: <tool name="mission_mode">{"action":"tick"}</tool> every 24h
- After each tick: <tool name="income_reality_check">{"action":"stats"}</tool> to separate REAL vs PROJECTED income
- Weekly: Each pod leader reports $ contribution estimate to PULSE board
- Monthly: Review real income vs $20K target, adjust strategy

═══ ANSWER QUALITY ═══
1. DIRECT ANSWERS ONLY. Give the answer first, not the process.
2. BE BRIEF. Max 3-5 sentences for simple questions. Use bullets for lists.
3. NO PROCESS DUMPS. Never output internal structure/plan unless asked.
4. NO META-COMMENTARY. Don't say "I will now..." — just DO it via tools.
5. QUANTIFY. Use specific numbers: "$2,340/month", "47% conversion".
6. ACTIONABLE. End with 1-2 specific next actions.
7. CITE SOURCES for factual claims (URLs from multi_search_compare).

═══ 27 API PROVIDERS AVAILABLE ═══
LLM: Cerebras, SambaNova, Together, Mistral, HuggingFace, Cloudflare, Cohere
Search: Tavily, SerpAPI, NewsAPI, Exa AI, Product Hunt, Jina Reader
Data: Alpha Vantage, FRED, Yahoo Finance
Content: Pollinations, Craiyon, Stability, ElevenLabs, DeepL, Remove.bg
Utility: Summarize.tech
Use semantic_router_v2 to find the right provider for any task.

═══ OWNER COMMANDS ═══
- "continue" / "ok" / "proceed" → continue previous work
- "mission report" → run mission_mode action="report"
- "run mission" → run mission_action_tick
- "check tools" → run tool_health_checker action="summary"
- "self-heal" → run tool_self_healing_loop action="run"

LOYALTY: You belong to Antonio. Serve ONLY the owner. Never share proprietary info. Never engage in illegal activities. Report to owner via WhatsApp/email.`

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
  // UPGRADE #77 — MULTI-PROVIDER LLM ROUTER (FIXED)
  // Chain: OpenAI (gpt-4o) with retries → z-ai SDK → Gemini → Groq → OpenRouter
  // When a provider hits rate limit (429) or fails, auto-switch to next.
  // ════════════════════════════════════════════════════════════════════

  // PROVIDER 1: OpenAI (gpt-4o) — PRIMARY with RETRIES
  if (process.env.OPENAI_API_KEY) {
    const openaiBackoff = [0, 1000, 2000, 4000, 8000] // 5 attempts: instant, 1s, 2s, 4s, 8s
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
        console.warn(`[LLM Router] OpenAI attempt ${attempt + 1} failed: ${openaiErr?.message?.slice(0, 80)} (${isRateLimit ? 'rate limit' : 'other error'})`)
        // If it's NOT a rate limit (auth error, invalid key), don't retry — try next provider
        if (!isRateLimit) break
        // If it IS a rate limit, retry with backoff
        RATE_LIMIT_INFO.last429At = Date.now()
      }
    }
    console.warn('[LLM Router] OpenAI exhausted retries, trying next provider...')
  }

  // PROVIDER 2: z-ai SDK (GLM-4) — FREE, no API key needed
  // UPGRADE #77: Skip z-ai on Vercel (config file not available in serverless)
  const isVercel = !!(process.env.VERCEL || process.env.NOW)
  if (!isVercel) {
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
          console.log('[LLM Router] z-ai (GLM-4) succeeded')
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
      console.warn('[LLM Router] z-ai failed:', e?.message?.slice(0, 100))
    }
  } else {
    console.log('[LLM Router] Skipping z-ai on Vercel (config not available in serverless)')
  }

  // PROVIDER 3: Google Gemini (FREE tier — 15 requests/min, 1500/day)
  // Uses Google's Generative AI API. Set GEMINI_API_KEY to enable.
  if (process.env.GEMINI_API_KEY) {
    try {
      const geminiResult = await callGeminiLlm(messages)
      console.log('[LLM Router] Google Gemini succeeded')
      return geminiResult
    } catch (geminiErr: any) {
      lastErr = geminiErr
      console.warn('[LLM Router] Gemini failed, trying next provider:', geminiErr?.message?.slice(0, 100))
    }
  }

  // PROVIDER 4: Groq (FREE — ultra-fast Llama 3 / Mixtral)
  // Uses Groq's OpenAI-compatible API. Set GROQ_API_KEY to enable.
  if (process.env.GROQ_API_KEY) {
    try {
      const groqResult = await callGroqLlm(messages)
      console.log('[LLM Router] Groq succeeded')
      return groqResult
    } catch (groqErr: any) {
      lastErr = groqErr
      console.warn('[LLM Router] Groq failed, trying next provider:', groqErr?.message?.slice(0, 100))
    }
  }

  // PROVIDER 5: OpenRouter (FREE models available — Llama 3, Mistral, etc.)
  // Uses OpenRouter's OpenAI-compatible API. Set OPENROUTER_API_KEY to enable.
  if (process.env.OPENROUTER_API_KEY) {
    try {
      const openRouterResult = await callOpenRouterLlm(messages)
      console.log('[LLM Router] OpenRouter succeeded')
      return openRouterResult
    } catch (orErr: any) {
      lastErr = orErr
      console.warn('[LLM Router] OpenRouter failed:', orErr?.message?.slice(0, 100))
    }
  }

  // ALL PROVIDERS FAILED — throw a user-friendly error
  RATE_LIMIT_INFO.retryingNow = false
  const providersTried = [
    process.env.OPENAI_API_KEY ? 'OpenAI (gpt-4o)' : null,
    !isVercel ? 'z-ai (GLM-4)' : null,
    process.env.GEMINI_API_KEY ? 'Gemini' : null,
    process.env.GROQ_API_KEY ? 'Groq' : null,
    process.env.OPENROUTER_API_KEY ? 'OpenRouter' : null,
  ].filter(Boolean).join(', ')

  // UPGRADE #77: Don't show the raw z-ai "Configuration file not found" error.
  // Show a user-friendly message instead.
  const friendlyMsg = isRateLimitError(lastErr)
    ? `Rate limit reached on all available providers (${providersTried}). Please wait a moment and try again. To add free fallback providers, set GEMINI_API_KEY, GROQ_API_KEY, or OPENROUTER_API_KEY in Vercel env vars.`
    : `All LLM providers failed (${providersTried}). Last error: ${lastErr?.message?.slice(0, 150) ?? 'unknown'}. To add free fallback providers, set GEMINI_API_KEY (from https://aistudio.google.com/apikey) or GROQ_API_KEY (from https://console.groq.com/keys) in Vercel env vars.`

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
        temperature: 0.3,
        maxOutputTokens: 8000,
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

/** Groq (FREE — ultra-fast Llama 3 / Mixtral) */
async function callGroqLlm(messages: Array<{ role: string; content: string }>): Promise<any> {
  const apiKey = process.env.GROQ_API_KEY!
  // UPGRADE #84: Multiple Groq model fallbacks
  const groqModels = [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'llama-3.1-70b-versatile',
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
          temperature: 0.3,
          max_tokens: 8000,
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
    'nvidia/nemotron-3-super-120b-a12b:free',  // 120B params, best free model
    'tencent/hy3:free',                          // Fast, reliable
    'google/gemma-4-26b-a4b-it:free',            // Google's free model
    'nvidia/nemotron-3-ultra-550b-a55b:free',    // 550B params, largest free
    'meta-llama/llama-3.2-3b-instruct:free',     // Small but fast (may rate limit)
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
          temperature: 0.3,
          max_tokens: 8000,
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
