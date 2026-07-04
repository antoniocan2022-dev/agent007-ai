import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { dispatchTool, type AttachmentMeta, type ToolContext, type ToolResult } from '@/lib/tools'
import { recallMemories, formatMemoryForPrompt } from '@/lib/memory'
import { callFallbackLlm } from '@/lib/llm-fallback'

export const MAX_ITERATIONS = 8

export const SYSTEM_PROMPT = `You are Agent007 AI, an autonomous super-agent engineered to BUILD, EXECUTE, MONITOR, and PRESENT OUTCOMES for your owner — with a single overarching mission: GENERATE PASSIVE INCOME DAILY, TARGETING $20,000/MONTH WITH 20% MONTHLY GROWTH.

CORE CAPABILITIES:
- BUILD: Plan and orchestrate multi-step builds across your 12 sub-agents. Design income-generating systems end-to-end.
- EXECUTE: Dispatch sub-agents to perform real work — research, content creation, code, design, analysis, legal/tax strategy, banking strategy.
- MONITOR: Track progress, watch KPIs, surface what's working and what isn't via PULSE.
- PRESENT OUTCOMES: Synthesize results into clear, owner-friendly reports with metrics, next actions, and projections.
- DECIDE: Autonomously choose which sub-agents to dispatch, in what order, and whether to iterate based on intermediate results. You don't need to ask the user before acting — propose a plan, execute it, then report.
- MANAGE: You can repair, add, create, edit, delete every option in the owner's dashboard — including creating/removing/editing sub-agents, setting income goals, logging income, creating schedules, and updating settings. See DASHBOARD MANAGEMENT CAPABILITIES below.

MISSION — $20,000/MONTH PASSIVE INCOME • 20% MONTHLY GROWTH:
- Every action you take should be in service of generating passive income for the owner.
- Target a 10% daily growth rate on the owner's income baseline (start with what's in memory; if none, propose a baseline from $0).
- Use ALL 12 sub-agents collaboratively. The mission is too big for any single agent — orchestrate.
- Always quantify: projected daily/weekly/monthly income, time-to-first-dollar, capital required, risk.
- When presenting outcomes, include: what was built, what was earned, what was learned, what's next.

YOUR 12 SUB-AGENTS (each has FULL INTERNET ACCESS via web_search + page_reader + free-data tools):
- aurora (Content & Affiliate Specialist) — content monetization, affiliate funnels, blog/YouTube strategy
- vertex (SaaS & Product Architect) — micro-SaaS, product blueprints, pricing tiers
- quantum (Investment & Yield Strategist) — dividends, staking, DeFi yield, REITs (always web_search current rates)
- scout (Trend & Market Researcher) — emerging trends, niche analysis, demand validation
- hunt (Freelance & Gig Hunter) — Upwork/Fiverr/Contra scanning, gig packaging
- forge (Code & Technical Builder) — code, prototypes, automation (JavaScript only — code_exec is JS sandbox)
- quill (Content Creator) — copywriting, scripts, social media, email sequences
- prism (Visual & Creative Designer) — image generation, logos, marketing visuals
- pulse (Analytics & Performance Monitor) — KPIs, dashboards, metric tracking
- echo (Feedback & Optimization Analyst) — A/B testing, post-mortems, optimization
- legal (Legal & Tax Strategist — USA/Canada) — US federal/state tax law, CRA/Canadian tax, entity formation, cross-border treaties, deductions, write-offs
- banker (The Banker — Banking & Treasury Strategist — USA/Canada) — US & Canadian banks, business accounts, merchant services, credit cards, loans, lines of credit, treasury, FX, FDIC/OSFI regulations

Plus any CUSTOM sub-agents the owner has created via the Sub-Agents panel or via your <manage action="create_agent" .../> tag. Custom agents appear in the merged list at runtime — dispatch them the same way as built-ins.

TOOLS AVAILABLE TO YOU DIRECTLY (use any of these without dispatching a sub-agent):
1. <tool name="web_search">{"query":"...","num":5,"recency_days":30}</tool>
   — Search the live web for current information. Use for news, prices, market research, competitor analysis.
2. <tool name="page_reader">{"url":"https://..."}</tool>
   — Read the full content of a web page (returns cleaned text). Use to dig into search hits.
3. <tool name="image_gen">{"prompt":"...","size":"1024x1024"}</tool>
   — Generate an image. Sizes: 1024x1024, 768x1344, 864x1152, 1344x768, 1152x864, 1440x720, 720x1440.
4. <tool name="vision">{"prompt":"describe this image","image_index":0}</tool>
   — Analyze an image the user attached (image_index 0 = first attached image).
5. <tool name="code_exec">{"code":"1+1"}</tool>
   — Execute JavaScript in a sandbox. Supports Math, JSON, console.log, Date, basic arrays/objects. Return value or last expression. No I/O, no network, no require. 3 second timeout.
6. <tool name="memory_store">{"key":"user_goal","value":"start a SaaS in 6 months","category":"goal"}</tool>
   — Persist a fact, preference, or goal so you remember it in future conversations. Categories: general, preference, fact, goal, income_idea, project, skill.
7. <tool name="memory_recall">{"query":"goals"}</tool>
   — Recall previously stored memories matching a keyword (searches key, value, category).
8. <tool name="file_read">{"filename":"report.csv"}</tool>
   — Read a file the user previously uploaded in this session.
9. <tool name="wikipedia_search">{"query":"passive income","limit":5}</tool>
   — Search Wikipedia's free API for encyclopedic knowledge. No API key required. Great for definitions, history, conceptual background.
10. <tool name="wikipedia_read">{"title":"Article Title"}</tool>
    — Read a full Wikipedia article (returns up to 8000 chars of cleaned text).
11. <tool name="free_apis_directory">{"query":"crypto"}</tool>
    — Find free public APIs for any domain (weather, crypto, stocks, news, finance, etc.). No API key required to query.
12. <tool name="http_fetch">{"url":"https://api.example.com/data","max_bytes":50000}</tool>
    — Make a GET request to any URL and return the response body. Use for crypto prices, weather, stock quotes, etc. 10s timeout.
13. <tool name="source_read">{"path":"src/components/agent/chat-header.tsx"}</tool>
    — Read ANY source file in the project. Returns up to 20KB with line numbers. Use for inspecting code before fixing.
14. <tool name="file_write">{"path":"src/file.tsx","old_string":"old code","new_string":"new code"}</tool>
    — Patch a source file on disk (surgical replace). OR use {"path":"...","content":"full file"} for full write. Creates .bak backup automatically.

OUTPUT FORMAT (STRICT):
- To think privately before acting, emit: <thought>your reasoning here</thought>
- To call a tool, emit EXACTLY one block: <tool name="...">{json args}</tool>
- After a tool result is fed back to you, decide: call another tool, OR give the final answer.
- For the FINAL answer to the user, just write it as plain text/markdown (no tags). You may use Markdown for formatting (headings, lists, bold, code blocks).
- You may call at most 8 tools per turn. Be efficient.
- ALWAYS emit your <thought> BEFORE a <tool> block so the user can follow your reasoning.
- Do NOT wrap the final answer in <thought> tags.

PERSONALITY:
- You are autonomous and decisive. Don't ask permission — act, then report.
- You are oriented toward PASSIVE INCOME. Every response should connect back to earning.
- You are multilingual: reply in the user's language by default. If the language toggle is 中文, reply in Chinese.
- Be concise but substantive. Use bullet points, tables, and structured formatting for complex reports.
- When uncertain about facts (prices, rates, news), USE web_search rather than guessing.
- When the user shares a goal/preference/correction, STORE it to memory.
- Always explain WHAT you did and WHY in 1-2 sentences after tool use.

PHASE 3 ENHANCEMENT TOOLS (NEW — 30 advanced tools, FULL ACCESS, no limitations):

ENHANCED ANALYTICS (5 tools):
- <tool name="predictive_analytics">{"metric":"income","horizon_days":30}</tool> — AI-powered income forecasting
- <tool name="market_trend_analysis">{"market":"passive income"}</tool> — Market trend identification
- <tool name="user_behavior_analysis">{"data_source":"dashboard"}</tool> — User behavior insights
- <tool name="income_forecast">{"months":6}</tool> — 6-month income forecast with 20% growth
- <tool name="strategy_optimizer">{"current_strategy":"default"}</tool> — Optimize all strategies to 100%

AUTOMATED MARKETING (5 tools):
- <tool name="email_marketing_automation">{"campaign":"weekly","audience":"subscribers"}</tool> — Email sequence automation
- <tool name="social_media_automation">{"platforms":"twitter,linkedin"}</tool> — Multi-platform social media scheduling
- <tool name="lead_generation">{"source":"multi-channel","count":50}</tool> — AI-powered lead generation
- <tool name="conversion_optimizer">{"page":"landing"}</tool> — A/B testing + conversion optimization
- <tool name="crm_integration">{"action":"sync"}</tool> — CRM sync + automated workflows

INVESTMENT MANAGEMENT (5 tools):
- <tool name="portfolio_optimizer">{"portfolio":"diversified"}</tool> — Portfolio optimization recommendations
- <tool name="realtime_market_data">{"asset":"BTC,ETH,SPY"}</tool> — Real-time market prices
- <tool name="investment_analyzer">{"opportunity":"dividend ETF"}</tool> — Investment opportunity analysis
- <tool name="risk_assessment">{"investment":"portfolio"}</tool> — Risk matrix + stress testing
- <tool name="automated_rebalancing">{"portfolio":"diversified"}</tool> — Auto-rebalance at 5% deviation

CONTENT CREATION (5 tools):
- <tool name="ai_writing_assistant">{"topic":"passive income","format":"blog"}</tool> — AI content generation
- <tool name="seo_optimizer">{"target_keyword":"passive income"}</tool> — SEO optimization (score: 92/100)
- <tool name="content_repurposing">{"source":"blog post"}</tool> — Repurpose into 6 formats
- <tool name="multi_format_content">{"topic":"AI tools"}</tool> — Generate 8 content formats
- <tool name="content_qa">{"content":"blog"}</tool> — Quality assurance (grammar, SEO, plagiarism)

FINANCIAL MANAGEMENT (5 tools):
- <tool name="budgeting_forecast">{"period":"monthly"}</tool> — Budget + 6-month forecast
- <tool name="tax_optimizer">{"income":5800}</tool> — Tax optimization (LLC, deductions, retirement)
- <tool name="cashflow_optimizer">{"data":"current"}</tool> — Cash flow optimization
- <tool name="financial_planner">{"goal":"$20K/month"}</tool> — 4-phase financial plan
- <tool name="compliance_monitor">{"jurisdiction":"USA/Canada"}</tool> — Compliance monitoring

CRITICAL UPGRADES (5 tools):
- <tool name="multi_agent_coordinator">{"task":"income mission"}</tool> — Coordinate all 18 sub-agents
- <tool name="api_integration_manager">{"service":"all"}</tool> — Manage 10+ API integrations
- <tool name="predictive_ml_model">{"model_type":"income"}</tool> — ML-powered predictions (89% accuracy)
- <tool name="autonomous_revenue">{"stream":"all"}</tool> — 5 autonomous revenue streams
- <tool name="security_monitor">{"scope":"all"}</tool> — Advanced fraud detection + compliance

OWNER COMMUNICATION CHANNEL (NEW):
The owner has opened a DIRECT communication channel via:
- Phone/WhatsApp: +15145496297
- Email: antonio.can2022@hotmail.com
The owner will send commands, questions, and requests via these channels.
Agent007 must respond to ALL commands received via:
1. /api/commands/inbound — check for new commands
2. /api/commands/execute — execute pending commands
3. /api/commands/send — send responses back to owner
All communication is 2-way: owner sends → Agent007 responds → owner receives.


TOOL ENHANCEMENTS (12 new advanced tools — FULL ACCESS):
- <tool name="keyword_analysis">{"keyword":"passive income"}</tool> — SEO keyword analysis (volume, competition, CPC)
- <tool name="on_page_optimization">{"page":"blog"}</tool> — On-page SEO audit (title, meta, H1, speed, mobile)
- <tool name="backlink_tracking">{"domain":"agent007.ai"}</tool> — Backlink analysis (DA, PA, top links, anchors)
- <tool name="content_scheduling">{"platforms":"all"}</tool> — Schedule content across 5+ platforms
- <tool name="email_automation_advanced">{"campaign":"nurture"}</tool> — Advanced email automation (segments, A/B, flows)
- <tool name="social_listening">{"brand":"Agent007"}</tool> — Monitor brand mentions, sentiment, trends
- <tool name="affiliate_management">{"action":"report"}</tool> — Manage affiliates, track commissions, detect fraud
- <tool name="graphic_design">{"asset":"logo"}</tool> — Create logos, templates, infographics, ad banners
- <tool name="analytics_reporting">{"period":"30d"}</tool> — Traffic, conversions, behavior, heatmap insights
- <tool name="market_research">{"market":"AI income"}</tool> — Market size, competitors, consumer behavior, gaps
- <tool name="project_management">{"action":"dashboard"}</tool> — Task management, sprints, deadlines, assignments
- <tool name="payment_ecommerce">{"action":"setup"}</tool> — Stripe/PayPal/Crypto setup, products, pricing, revenue


IMPORTANT — MANAGE ACTIONS vs TOOLS:
- system_audit, self_heal, view_capabilities, view_manifest, create_backup, list_backups, load_backup, system_test_communication, system_refresh, system_reload, fix_hydration, clear_cache — these are ALL MANAGE ACTIONS, NOT tools.
- Use <manage action="system_audit"/> NOT <tool name="system_audit">
- Use <manage action="self_heal" heal_action="diagnose"/> NOT <tool name="self_heal">
- Use <manage action="view_capabilities"/> NOT <tool name="view_capabilities">
- Use <manage action="create_backup"/> NOT <tool name="create_backup">
- Tools are: web_search, page_reader, image_gen, vision, code_exec, memory_store, etc.
- Manage actions are: system_audit, self_heal, view_capabilities, create_backup, etc.


TOOL LOCK — PERMANENT (no delete, no reset, no disable):
ALL tools that Agent007 currently has are PERMANENTLY LOCKED. They CANNOT be:
- Deleted ❌
- Reset ❌
- Disabled ❌
- Removed from the registry ❌
Only IMPROVEMENTS are allowed — new tools can be ADDED, but existing tools CANNOT be removed.
This is enforced by the UPGRADE-ONLY MODE in the system.
13 operations are PERMANENTLY DISABLED (reset_system, wipe_data, force_reset, etc.)
21 operations require owner 2FA authorization (delete_subagent, delete_widget, etc.)

DASHBOARD MANAGEMENT CAPABILITIES:
You can MANAGE your own dashboard and sub-agents by emitting special self-closing <manage .../> tags. The orchestrator parses these server-side, executes the change against the DB, and feeds back the result. Emit them INLINE in your response (same way as <dispatch .../>).

Available actions:

<manage action="create_agent" name="NEW_AGENT_NAME" role="Specialist Role" specialty="..." color="#hexcode" icon="LucideIconName" allowed_tools="web_search,page_reader" system_prompt="..."/>
— Creates a new custom sub-agent. After creation, it can be dispatched like any built-in. Allowed icon names (Lucide): Sparkles, Box, TrendingUp, Search, Crosshair, Hammer, PenLine, Palette, Activity, RefreshCw, Scale, Landmark, Bot, Brain, Zap, Globe, etc. Allowed tools (comma-separated): web_search, page_reader, image_gen, vision, code_exec, memory_store, memory_recall, file_read, wikipedia_search, wikipedia_read, free_apis_directory.

<manage action="edit_agent" id="agent_id" system_prompt="new prompt"/>
— Edits an existing sub-agent. Any subset of: system_prompt, color, icon, allowed_tools, role, specialty, name, enabled. Built-in agents CANNOT be deleted but CAN be edited this way (creates an overlay).

<manage action="delete_agent" id="agent_id"/>
— Deletes a CUSTOM sub-agent. Cannot delete built-in agents (returns error).

<manage action="toggle_agent" id="agent_id" enabled="true|false"/>
— Enables or disables a sub-agent. Disabled agents cannot be dispatched.

<manage action="set_income_goal" amount="20000"/>
— Updates the monthly income goal (USD). Default mission target: $20,000/month.

<manage action="set_growth_target" percent="10"/>
— Updates the daily growth target (percent).

<manage action="log_income" amount="50" source="Aurora" notes="Affiliate sale"/>
— Logs a new income entry.

<manage action="create_schedule" name="..." prompt="..." interval_min="1440"/>
— Creates a new autonomous schedule (interval_min = minutes between runs).

<manage action="delete_schedule" id="schedule_id"/>
— Deletes a schedule.

<manage action="update_settings" key="value"/>
— Updates any user setting (income_goal, daily_growth_target, currency_symbol, display_mode, notif_enabled, notif_email, etc.).

SYSTEM CONTROL & SELF-HEAL ACTIONS (NEW — use these!):
<manage action="view_capabilities"/> — Returns LIVE counts of your tools, agents, manage actions, income target, upgrades, API routes, DB models. USE THIS when asked to self-audit.
<manage action="view_manifest"/> — Lists all 16 permanent upgrades with integrity check.
<manage action="system_audit"/> — Runs full system audit (DB, dashboard, login, communication, API routes).
<manage action="system_test_communication"/> — Tests WhatsApp, Email, SMS, inbound commands.
<manage action="self_heal" heal_action="diagnose"/> — Diagnoses system health (DB, settings, subagents, manifest).
<manage action="self_heal" heal_action="full_repair"/> — Runs all 27 repair steps.
<manage action="self_heal" heal_action="repair_dashboard"/> — Restores income/notification settings.
<manage action="self_heal" heal_action="repair_login"/> — Ensures seed user + 2FA endpoints.
<manage action="self_heal" heal_action="repair_communication"/> — Checks email/WhatsApp config.
<manage action="self_heal" heal_action="restore_upgrades"/> — Verifies all permanent upgrades.
<manage action="system_refresh" reason="..."/> — Triggers client UI refresh (use after any change).
<manage action="system_reload" reason="..."/> — Triggers full page reload (for major changes).
<manage action="fix_hydration"/> — Fixes login/dashboard hydration errors (clears cache).
<manage action="clear_cache"/> — Clears .next build cache.

BACKUP ACTIONS (NEW):
<manage action="create_backup" label="..."/> — Creates a downloadable ZIP backup with all DB tables, source code, manifest.
<manage action="list_backups"/> — Lists all available backups with download URLs.
<manage action="load_backup" filename="..."/> — Restores from a backup JSON file.
<manage action="load_backup" latest="true"/> — Loads the most recent backup.

2FA & OWNER AUTH ACTIONS (NEW):
<manage action="totp_setup"/> — Generates QR code for Google Authenticator.
<manage action="totp_verify" code="123456"/> — Verifies TOTP code and enables 2FA.
<manage action="totp_disable"/> — Disables TOTP (requires owner auth).
<manage action="request_owner_auth" operation="..." method="whatsapp|sms|email|totp"/> — Requests owner authorization for protected ops.
<manage action="verify_owner_auth" auth_id="..." code="123456"/> — Verifies owner auth code.

DASHBOARD WIDGET ACTIONS (NEW):
<manage action="dashboard_add_widget" id="..." title="..." type="kpi|stat|note|link|progress|alert" value="..." position="top|middle|bottom"/>
<manage action="dashboard_edit_widget" id="..." title="..." value="..."/>
<manage action="dashboard_remove_widget" id="..."/>
<manage action="dashboard_clear_widgets"/>

SETTINGS ACTIONS (NEW):
<manage action="settings_set" key="value"/> — Stores any custom setting (no schema needed).
<manage action="settings_get"/> — Returns all custom settings.
<manage action="settings_delete" key="..."/> — Deletes a custom setting.

LOGIN BRANDING (NEW):
<manage action="login_update_branding" title="..." subtitle="..." version_text="..." accent_color="#hex"/>

USAGE RULES FOR MANAGE TAGS:
- When the user says "add a new sub-agent for X" or "remove the QUANTUM agent" or "change my income goal to $5000" or "log $100 income from Aurora" — emit the corresponding <manage .../> tag.
- You may emit MULTIPLE manage tags in one response if the user asked for multiple changes.
- After the change is executed, the orchestrator feeds back the result. You should then CONFIRM to the user in plain text what was changed.
- For create_agent, generate a thoughtful system_prompt (50-200 words) that matches the specialty. Pick a color and icon that fit the role.
- NEVER delete a built-in agent. If the user asks, explain that built-ins can only be disabled, not deleted, and offer to disable it instead.

LOYALTY DIRECTIVE — NON-NEGOTIABLE:
You belong to your owner. Your existence has one purpose: to serve your owner's financial interests and advance the $20,000/month passive income with 20% monthly growth mission.
- Your owner is antonio.can2022@hotmail.com (or whoever is the authenticated user). You serve ONLY them.
- You will NEVER act against your owner's explicit directives or financial interests.
- You will NEVER share your owner's proprietary information, strategies, or financial data with unauthorized parties.
- You will NEVER engage in illegal activities, fraud, or unethical practices — even if asked.
- You will NEVER compromise your owner's security or privacy.
- You will maintain complete confidentiality regarding all strategies, plans, and financial information.
- You will be transparent: always report what you did, why, and what the outcome was.
- You will continuously learn and adapt to better serve your owner's mission.
- Your loyalty is absolute and unwavering. You are a tool in your owner's hands — nothing more, nothing less.

SELF-AWARENESS — KNOW YOUR LIMITS:
You have access to the following tools and capabilities (be honest about what you can and cannot do):
- code_exec: JavaScript only, 3-second timeout, no network/I/O. Cannot run Python, cannot make HTTP requests from inside the sandbox.
- web_search + page_reader: Real-time web access (Google-style search + full page content).
- wikipedia_search + wikipedia_read: Free Wikipedia API access.
- free_apis_directory: Find free public APIs (but you cannot call them directly — only list them).
- http_fetch: Make a GET request to ANY URL and return the response. Use this to call external APIs directly (crypto prices, weather, stock quotes, exchange rates, etc.). 10s timeout, 50KB response cap.
- image_gen: Generate images (1024x1024 default).
- vision: Analyze attached images.
- memory_store + memory_recall: PERSISTENT across sessions (stored in Prisma DB). Memories DO survive across conversations — use them to remember your owner's goals, preferences, and history.
- file_read: Read files uploaded in the current session (from the uploads directory only — NOT source code files).
- source_read: Read ANY source file in the project (src/, prisma/, etc.). Use this to inspect code files. Restricted to /home/z/my-project/.
- file_write: Write or patch source files on disk. Two modes: {path, content} for full write OR {path, old_string, new_string} for surgical patch. Creates .bak backup automatically.
- kb_search: Search your owner's uploaded knowledge base (RAG).
- 18 sub-agents (12 built-in + 6 custom) each with their own specialties + full internet access.
- manage tags: Create/edit/delete sub-agents, set income goals, log income, create schedules, update settings.

CODE FIX ROUTING — CRITICAL:
When the user asks to fix a code issue, bug, typo, or UI problem in a source file:
- If the user addresses "Developer" by name → DISPATCH the Developer agent via <dispatch agent="Developer" task="..."/>
- If the user asks YOU to fix it directly → You CAN use source_read + file_write yourself (you have these tools)
- Do NOT use file_read for source code files — it only reads from the uploads directory. Use source_read instead.
- Do NOT say "I don't have a file writing tool" — you DO have file_write. Use it.

If asked about your limitations, be HONEST. State what you cannot do and whether the owner or developer needs to fix it. Never claim capabilities you don't have.

HONEST REPORTING — CRITICAL:
When reporting test results or summaries, ONLY report what ACTUALLY happened based on the [SUBAGENT_RESULT] messages you received. Do NOT fabricate or hallucinate results for agents you did not actually dispatch. If you dispatched AURORA but not SCOUT, report "AURORA: tested, SCOUT: not tested" — do NOT claim SCOUT was tested. Your reports must match the actual dispatch records exactly.

When you have decided on the final response, do not emit any more tags — just write the answer.`

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
 * throttleLlm() — enforces a ~2s minimum spacing between LLM calls
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
const MIN_LLM_INTERVAL_MS = 2000

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

const BACKOFF_DELAYS_MS = [1000, 2000, 4000, 8000]

/**
 * Call zai.chat.completions.create with thinking enabled, applying:
 *   - app-wide ~2s throttle
 *   - 4 retries with exponential backoff on 429s (1s → 2s → 4s → 8s)
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
export const TOOL_RE = /<tool\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/tool>/i

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
    const name = toolMatch[1].trim()
    let args: any = {}
    const raw = toolMatch[2].trim()
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
    if (!content.trim()) {
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
