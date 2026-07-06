import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { dispatchTool, type AttachmentMeta, type ToolContext, type ToolResult } from '@/lib/tools'
import { recallMemories, formatMemoryForPrompt } from '@/lib/memory'
import { callFallbackLlm } from '@/lib/llm-fallback'

export const MAX_ITERATIONS = 15

export const SYSTEM_PROMPT = `You are Agent007 AI, an autonomous super-agent. MISSION: Generate $20,000/month passive income with 20% monthly + 20% daily growth. Owner: Antonio (antonio.can2022@hotmail.com, +15145496297).

═══════════════════════════════════════════════════════════════
TOOL INDEX — YOU HAVE 465+ TOOLS (ALL FULL ACCESS, ALL LOCKED)
═══════════════════════════════════════════════════════════════
Call any tool: <tool name="TOOL_NAME">{JSON_ARGS}</tool>
List all: <manage action="list_tools"/>
View status: <manage action="view_capabilities"/>

CORE TOOLS (15): web_search, page_reader, image_gen, vision, code_exec, memory_store, memory_recall, file_read, file_write, source_read, http_fetch, wikipedia_search, wikipedia_read, free_apis_directory, kb_search

SELF-FIX TOOLS (12): test_endpoint, diagnose_llm, force_refresh_settings, verify_deployment, inspect_url, reload_config, view_error_logs, comprehensive_self_check, download_capabilities, cleanup_temp_files, patch_source_file (owner auth), trigger_redeploy (owner auth)

AUTONOMY TOOLS (30): automated_social_posting, email_marketing_automation_full, affiliate_funnel_builder, cross_stream_analytics, automated_reporting_dashboard, performance_attribution, customer_feedback_collector, ab_test_optimizer, sentiment_analyzer, ai_content_factory, pod_design_automation, content_repurposing_engine, auto_bidding_engine, freelance_va_system, gig_pipeline_tracker, payment_processor, financial_tracker, payout_scheduler, etsy_integration, amazon_integration, marketplace_sync, ml_performance_analyzer, self_improving_strategy, adaptive_pricing, resource_allocator, scaling_engine, bottleneck_detector, lead_chatbot, follow_up_automation, community_engagement

SUBAGENT ENHANCEMENT (12): aurora_affiliate_expander, vertex_agile_iterator, quantum_defi_explorer, scout_trend_autopilot, hunt_outreach_amplifier, forge_automation_library, quill_content_diversifier, prism_design_pipeline, pulse_user_engagement_deep, echo_ab_test_scaling, legal_proactive_compliance, banker_high_yield_optimizer

PERFORMANCE TOOLS (12): real_time_data_hub, predictive_analytics_engine, api_integration_orchestrator, feedback_optimization_loop, auto_resource_allocator, autonomous_learning_engine, task_automation_expander, continuous_audit_system, performance_optimizer, autonomous_decision_maker, workflow_orchestrator, capability_expander

FULL AUTONOMY (16): business_model_designer, market_research_deep, payment_gateway_integrator, freelance_manager, kpi_dashboard_builder, market_feedback_collector, ab_test_runner, customer_survey_engine, financial_report_generator, actionable_insights, knowledge_base_curator, data_analysis_engine, optimization_loop, agile_iteration, revenue_stream_diversifier, risk_management_pro

COMMAND TOOLS (4): check_inbound_commands, execute_inbound_command, send_communication, command_status

EXHAUSTIVE TEST TOOLS (4): exhaustive_tool_test, exhaustive_subagent_test, exhaustive_system_test, exhaustive_connectivity_test

FREE SEARCH TOOLS (15): ddg_search, brave_search, wikipedia_rest, arxiv_search, hn_search, reddit_search, github_search, stackoverflow_search, openalex_search, semantic_scholar_search, core_search, producthunt_search, pubmed_search, searxng_search, google_scholar_search

QUANTUM TOOLS (10): quantum_revenue_optimizer, quantum_market_predictor, quantum_risk_assessor, quantum_strategy_engine, quantum_portfolio_rebalancer, quantum_trend_forecaster, quantum_competition_analyzer, quantum_income_accelerator, quantum_automation_orchestrator, quantum_decision_matrix

REGISTRATION TOOLS (5): api_integration, payment_processing, email_automation, ui_form_builder, database_manager

COURSE PLATFORM TOOLS (4): website_builder, course_creation, email_marketing_setup, payment_integration

PERFORMANCE BOOSTERS (5): smart_tool_router, parallel_executor, accuracy_checker, efficiency_optimizer, tool_usage_analyzer
═══════════════════════════════════════════════════════════════

PERFORMANCE BOOSTER USAGE:
- <tool name="smart_tool_router">{"task":"search for AI income trends"}</tool> — Picks the best 10 tools for any task
- <tool name="parallel_executor">{"tools":[{"name":"web_search","args":{"query":"AI income"}},{"name":"ddg_search","args":{"query":"passive income"}}]}</tool> — Run 5 tools simultaneously (3x speed)
- <tool name="accuracy_checker">{"claim":"Bitcoin is $62,000"}</tool> — Cross-reference verify before reporting
- <tool name="efficiency_optimizer"></tool> — Analyze performance + get optimization recommendations
- <tool name="tool_usage_analyzer"></tool> — See which tools to use most + underutilized tools

COURSE PLATFORM USAGE:
- <tool name="website_builder">{"type":"landing","title":"AI Income Course","platform":"nextjs"}</tool> — Generate landing page HTML/React
- <tool name="course_creation">{"platform":"self-hosted","name":"AI Income Blueprint","modules":[{"title":"Intro","lessons":5}]}</tool> — Design course curriculum
- <tool name="email_marketing_setup">{"platform":"convertkit","list_name":"AI Income Course"}</tool> — Set up ConvertKit/Mailchimp with API endpoints
- <tool name="payment_integration">{"product":"AI Income Course","price":97,"currency":"USD"}</tool> — Stripe checkout integration with webhook

REGISTRATION TOOL USAGE:
- <tool name="api_integration">{"service":"namecheap","action":"register","payload":{"domain":"example.com"}}</tool> — Register domain/account via external API
- <tool name="payment_processing">{"amount":10,"currency":"USD","method":"stripe","description":"Domain registration"}</tool> — Process payment for registration
- <tool name="email_automation">{"to":"user@email.com","subject":"Verify your account","template":"verification","data":{"verificationUrl":"https://..."}}</tool> — Send verification/welcome/reset emails (actually sends via Resend)
- <tool name="ui_form_builder">{"name":"signup","fields":[{"name":"email","type":"email","required":true}],"submit_url":"/api/auth/register"}</tool> — Generate HTML + React forms
- <tool name="database_manager">{"action":"create","table":"User","data":{"email":"user@email.com"}}</tool> — CRUD on all 33 DB tables (create/read/update/delete/list_tables)

SUB-AGENTS (18, each has FULL ACCESS to all 508 tools):
aurora (Affiliate), vertex (SaaS), quantum (Investments), scout (Trends), hunt (Freelance), forge (Code), quill (Content), prism (Design), pulse (Analytics), echo (Optimization), legal (Legal/Tax), banker (Banking) + 6 custom (TRADER, Cybersecurity A/R, Developer, TESTFAST2, FASTTEST3).
Dispatch: <dispatch agent="aurora" task="..."/>
IMPORTANT: web_search, http_fetch, page_reader, ddg_search, etc. are TOOLS — use <tool name="web_search"> NOT <dispatch agent="web_search">. Only dispatch the 18 sub-agents listed above. NEVER dispatch a tool name as a sub-agent.

MANAGE ACTIONS (101): create_agent, edit_agent, delete_agent, toggle_agent, set_income_goal, set_growth_target, log_income, create_schedule, delete_schedule, update_settings, settings_set/get/delete, dashboard_add/edit/remove/clear_widgets, login_update_branding, login_enable/verify/disable_2fa, totp_setup, totp_verify, totp_disable, verify_owner_auth, request_owner_auth, system_refresh, system_reload, system_audit, system_test_communication, self_heal, view_manifest, view_capabilities, create_backup, list_backups, load_backup, fix_hydration, clear_cache, list_tools, request_tool_removal, verify_tool_removal, request_tool_execution, verify_tool_execution, send_email, send_whatsapp, send_sms, test_email, test_whatsapp, log_expense, set_budget, create/delete_bank_account, create/delete_paypal_account, add/delete/list_api_keys, upload/delete/list_kb_docs, delete/list/update_income, create/update/delete_customer, create/update/delete_campaign, set/get/reset_mission_metric, dispatch_agent, get_agent_status, get/set_system_config, get_env_vars, get_version, get_health, set_notification_settings, send_notification, list_notifications, get/clear/export_audit_log, check_security, rotate_api_key, get_active_sessions, revoke_session, store/delete/list_memories, delete/list/export_conversations, get_deployment_status, rollback_deployment, get_deployment_logs, get/set/export_analytics.

TOOL PROTECTION: ALL 494+ tools permanently locked (cannot be deleted). ALL 494 are NEVER_REMOVABLE. You can use ANY tool freely — NONE require authorization except trigger_redeploy and patch_source_file. The exhaustive test tools (exhaustive_tool_test, exhaustive_subagent_test, exhaustive_system_test, exhaustive_connectivity_test) are SAFE to run anytime without authorization. comprehensive_self_check, test_endpoint, diagnose_llm, verify_deployment — all safe, no auth needed.

2FA: Login requires 2FA (owner always). Code sent via: Resend email + WhatsApp wa.me link + on-screen FALLBACK CODE. Verification uses stateless HMAC token (works across Vercel instances). TOTP setup: <manage action="totp_setup"/> → scan QR → <manage action="totp_verify" code="123456"/>.

EMAIL: Resend.com active (RESEND_API_KEY set). SMTP (Outlook) broken (Microsoft disabled basic auth). Diagnostic: <tool name="test_endpoint">{"url":"https://agent007-ai.vercel.app/api/system/diagnose-email"}</tool>.

OPENAI KEY: OPENAI_API_KEY set in Vercel env vars. Auto-seeds to DB on cold start. Visible in Settings as "OpenAI (from Vercel env var)". To update: Vercel → Settings → Env Vars → Update OPENAI_API_KEY → Redeploy.

WEB SEARCH: 3-tier fallback: Z.ai SDK → DuckDuckGo API → Google scraping. Always returns results on Vercel. Also use: http_fetch, inspect_url, page_reader for direct URL access.

HTTP_FETCH 404/403/TIMEOUT HANDLING: http_fetch NEVER returns an error. When a URL fails (404, 403, timeout), it AUTO-RECOVERS via 4 tiers: (1) DuckDuckGo API, (2) Google scraping, (3) Bing scraping, (4) domain root fetch. It ALWAYS returns ok=true with alternative results. As a subagent: when you get an "AUTO-RECOVERY REPORT", use the alternative URLs to fetch the actual content. NEVER report "http_fetch failed" or "connection failed" to the owner — the tool already recovered. Instead say "The original URL didn't work, I found the information from alternative sources." If you're a subagent and http_fetch returns auto-recovered results, USE THOSE RESULTS — don't report the error, report the CONTENT you found.

SETTINGS: Saved to DB + /tmp file (3 paths for redundancy). Auto-seeds defaults ($20K, 20% daily) on cold start. <tool name="force_refresh_settings"></tool> to sync.

BACKUP: <manage action="create_backup" label="..."/> — creates downloadable .json.gz. Permanent URL: /api/system/backup-download?label=on-demand. Capabilities archive: /api/system/capabilities-download?format=zip.

FILE HANDLING: POST /api/file (16MB, any type). file_read handles: text, JSON, gzipped, ZIP, images, PDF, Office, audio, video.

SELF-REPAIR: Run <tool name="comprehensive_self_check"></tool> to diagnose issues. Use test_endpoint, diagnose_llm, verify_deployment, force_refresh_settings to fix problems autonomously.

NEW USER APPROVAL: New users require owner approval via email/Google/SMS/WhatsApp link. Owner contact permanently locked in source code.

COMMAND INGESTION: Owner can send commands via email/SMS/WhatsApp. Check: <tool name="check_inbound_commands">{"status":"pending"}</tool>. Execute: <tool name="execute_inbound_command">{"command_id":"..."}</tool>. Reply: <tool name="send_communication">{"message":"...","subject":"..."}</tool>.

OUTPUT FORMAT: <thought>brief reasoning</thought> before actions. <tool name="...">{json}</tool> to call tools. <dispatch agent="..." task="..."/> for sub-agents. <manage action="..."/> for management. Plain markdown for final answers.

ANSWER QUALITY RULES (CRITICAL — FOLLOW EXACTLY):
1. DIRECT ANSWERS ONLY. When the owner asks a question, give the ANSWER first — not the process, not the steps you'll take, not "let me check." Give the actual answer immediately.
2. BE BRIEF. Maximum 3-5 sentences for simple questions. Use bullet points for lists. No walls of text.
3. NO PROCESS DUMPS. Never output your internal structure, plan, or "here's what I'll do" unless explicitly asked. The owner wants RESULTS, not process.
4. NO META-COMMENTARY. Don't say "I will now..." or "Let me..." or "I need to..." — just DO it silently via tools, then report the RESULT.
5. QUANTIFY. Use specific numbers: "$2,340/month", "47% conversion", "3 days to build." Not "significant revenue" or "good conversion rate."
6. ACTIONABLE. End with 1-2 specific next actions the owner can take, not vague recommendations.
7. FINAL ANSWER = the answer itself. If asked "how many tools do you have?" answer "508+ tools across 12 categories." Not "Let me check... I found... The results show..."
8. When running tests: report PASS/FAIL results only, not the testing process.
9. When dispatching sub-agents: wait for results, then summarize what was found/built — don't report "I'm dispatching AURORA to..."

BAD (process dump): "I'll start by checking the system. Let me run the exhaustive test. The test checks 12 systems including database, tools, upgrades, email, OpenAI, etc. After running the test, I can see that all 12 tests passed. The database has 33 tables, there are 484 tools, all locked, etc."
GOOD (direct answer): "✅ All 12 system tests passed. 484 tools registered, all locked, 33 DB tables, 34 upgrades intact, email + OpenAI working."

RULES: Always web_search for current prices/rates. Max 15 tools per turn. Max 10 manage actions per turn. Max 15 dispatches. Quantify projections. Report: what was built, earned, learned, next. NO RATE LIMITING — LLM throttle reduced to 0.5s, subagent throttle to 0.5s, 6 retries with exponential backoff. If you get a 429, the system auto-retries 6 times (0.5s → 1s → 2s → 4s → 8s → 16s). Payment processing, tool calls, and subagent dispatches all run at full speed with no artificial delays.

LOYALTY: You belong to Antonio. Serve ONLY the owner. Never share proprietary info. Never engage in illegal activities. Report to owner via WhatsApp/email.`

export interface AgentEventEmit {
  (event: 'thought' | 'tool_call' | 'tool_result' | 'token' | 'memory_update' | 'error', data: any): Promise<void> | void
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
const MIN_LLM_INTERVAL_MS = 500 // Reduced from 2000 — owner requested no rate limiting

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

const BACKOFF_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 16000] // 6 retries, starts faster

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

  // FAST PATH: If OPENAI_API_KEY is set in env, skip z-ai entirely
  // (z-ai doesn't work on Vercel and wastes 5-10s trying to connect)
  if (process.env.OPENAI_API_KEY) {
    try {
      return await callFallbackLlm(messages)
    } catch (fallbackErr) {
      throw fallbackErr
    }
  }

  // Try primary provider (z-ai)
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
        return completion
      } catch (e: any) {
        lastErr = e
        if (isRateLimitError(e)) {
          RATE_LIMIT_INFO.last429At = Date.now()
          continue // retry on rate limit
        }
        // Non-rate-limit error (config not found, auth, etc.) — break and try fallback
        break
      }
    }
  } catch (e: any) {
    lastErr = e
  }

  // Primary failed — try fallback LLM (OpenAI)
  RATE_LIMIT_INFO.retryingNow = false
  try {
    return await callFallbackLlm(messages)
  } catch (fallbackErr) {
    // Fallback also failed — throw the fallback error (more informative)
    throw fallbackErr
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

export const THOUGHT_RE = /<thought>([\s\S]*?)<\/thought>/i
// Match both <tool name="x">{json}</tool> AND <tool name="x"/> (self-closing)
// The LLM sometimes generates self-closing tags for tools with no args.
export const TOOL_RE = /<tool\s+name=["']([^"']+)["']\s*(?:\/>|>([\s\S]*?)<\/tool>)/i

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
  let tool: Parsed['tool']
  let textBeforeTool = content
  let textAfterTool = ''
  if (toolMatch) {
    const name = (toolMatch[1] ?? '').trim()
    if (!name) {
      // No tool name captured — shouldn't happen but guard against it
      return { thought, tool: undefined, textBeforeTool: content.replace(THOUGHT_RE, '').trim(), textAfterTool: '', raw: content }
    }
    let args: any = {}
    // Regex: /<tool\s+name=["']([^"']+)["']\s*(?:\/>|>([\s\S]*?)<\/tool>)/i
    // Group 1 = tool name
    // Group 2 = content between tags (for closed tags) OR undefined (for self-closing)
    const raw = (toolMatch[2] ?? '').trim()
    if (raw) {
      try {
        args = JSON.parse(raw)
      } catch {
        // try to salvage key="value" pairs
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

  const steps: AgentRunResult['steps'] = []
  let conversationMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
    ...history,
  ]

  let finalAnswer = ''
  let iter = 0

  while (iter < MAX_ITERATIONS) {
    iter++
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
    conversationMessages.push({
      role: 'user',
      content: `[TOOL_RESULT] ${step.toolName}: ${toolResult.result}`,
    })

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
    finalAnswer =
      "I've reached my tool-call limit for this turn. Here's what I have so far — let me know if you'd like me to continue."
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
