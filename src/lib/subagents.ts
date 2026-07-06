import { db } from '@/lib/db'
import { dispatchTool, type AttachmentMeta, type ToolContext, type ToolResult } from '@/lib/tools'
import { parseAssistant, callLlmWithRetry, THOUGHT_RE, friendlyLlmError } from '@/lib/agent'

/* ------------------------------------------------------------------ *
 * Sub-agent registry — 12 specialists orchestrated by Agent007 (Super)
 * ------------------------------------------------------------------ */

export interface Subagent {
  id: string
  name: string
  role: string
  specialty: string
  color: string // hex accent color
  icon: string // lucide icon name (string; client maps to component)
  allowedTools: string[]
  systemPrompt: string
  /** True if this is a built-in agent (cannot be deleted, can be edited). */
  isBuiltin?: boolean
  /** True if this row is enabled (built-in default = true). */
  enabled?: boolean
}

const ALL_TOOLS = [
  // ── Base tools (15) — original data + research tools ──────────────────
  'web_search',
  'page_reader',
  'image_gen',
  'vision',
  'code_exec',
  'memory_store',
  'memory_recall',
  'file_read',
  'wikipedia_search',
  'wikipedia_read',
  'free_apis_directory',
  'kb_search',
  'http_fetch',
  'source_read',
  'file_write',

  // ── Self-fix tools (12) — Agent007's self-repair capability ───────────
  'test_endpoint',
  'diagnose_llm',
  'force_refresh_settings',
  'verify_deployment',
  'inspect_url',
  'reload_config',
  // 'patch_source_file' — EXECUTION_PROTECTED, requires owner auth
  // 'trigger_redeploy' — EXECUTION_PROTECTED, requires owner auth
  // Note: The 2 execution-protected tools are NOT in FULL_ACCESS_TOOLS
  // because subagents cannot request owner authorization (only the super
  // agent can). If a subagent needs to trigger a redeploy or patch source,
  // it must report back to Agent007, who will request owner auth.
  'view_error_logs',
  'comprehensive_self_check',
  'download_capabilities',
  'cleanup_temp_files',

  // ── Autonomy toolkit (30) — full income-generation capability ─────────
  // Category 1: Automated Marketing
  'automated_social_posting',
  'email_marketing_automation_full',
  'affiliate_funnel_builder',
  // Category 2: Advanced Analytics
  'cross_stream_analytics',
  'automated_reporting_dashboard',
  'performance_attribution',
  // Category 3: Feedback Mechanism
  'customer_feedback_collector',
  'ab_test_optimizer',
  'sentiment_analyzer',
  // Category 4: Content Generation
  'ai_content_factory',
  'pod_design_automation',
  'content_repurposing_engine',
  // Category 5: Freelancing Automation
  'auto_bidding_engine',
  'freelance_va_system',
  'gig_pipeline_tracker',
  // Category 6: Payment Automation
  'payment_processor',
  'financial_tracker',
  'payout_scheduler',
  // Category 7: Marketplace Integration
  'etsy_integration',
  'amazon_integration',
  'marketplace_sync',
  // Category 8: Learning & Adaptation
  'ml_performance_analyzer',
  'self_improving_strategy',
  'adaptive_pricing',
  // Category 9: Resource Allocation
  'resource_allocator',
  'scaling_engine',
  'bottleneck_detector',
  // Category 10: User Engagement
  'lead_chatbot',
  'follow_up_automation',
  'community_engagement',

  // ── Subagent enhancements (12) — one specialized tool per built-in ────
  // Each subagent has its own enhancement tool that addresses the
  // specific improvement opportunity the owner identified.
  'aurora_affiliate_expander',
  'vertex_agile_iterator',
  'quantum_defi_explorer',
  'scout_trend_autopilot',
  'hunt_outreach_amplifier',
  'forge_automation_library',
  'quill_content_diversifier',
  'prism_design_pipeline',
  'pulse_user_engagement_deep',
  'echo_ab_test_scaling',
  'legal_proactive_compliance',
  'banker_high_yield_optimizer',

  // ── Performance enhancement tools (12) — 8 factors + 4 supporting ────
  // Covers: real-time data, predictive analytics, API integrations,
  // feedback, resource allocation, autonomous learning, task automation,
  // continuous audits, performance optimization, decision making,
  // workflow orchestration, capability expansion.
  'real_time_data_hub',
  'predictive_analytics_engine',
  'api_integration_orchestrator',
  'feedback_optimization_loop',
  'auto_resource_allocator',
  'autonomous_learning_engine',
  'task_automation_expander',
  'continuous_audit_system',
  'performance_optimizer',
  'autonomous_decision_maker',
  'workflow_orchestrator',
  'capability_expander',

  // ── Command ingestion tools (4) — receive commands from owner ────────
  'check_inbound_commands',
  'execute_inbound_command',
  'send_communication',
  'command_status',

  // ── Full autonomy tools (16) — 8 components × 2 tools ───────────────
  'business_model_designer',
  'market_research_deep',
  'payment_gateway_integrator',
  'freelance_manager',
  'kpi_dashboard_builder',
  'market_feedback_collector',
  'ab_test_runner',
  'customer_survey_engine',
  'financial_report_generator',
  'actionable_insights',
  'knowledge_base_curator',
  'data_analysis_engine',
  'optimization_loop',
  'agile_iteration',
  'revenue_stream_diversifier',
  'risk_management_pro',

  // ── Exhaustive test tools (4) — autonomous testing capability ───────
  'exhaustive_tool_test',
  'exhaustive_subagent_test',
  'exhaustive_system_test',
  'exhaustive_connectivity_test',
]

/* Free-data tools added to every sub-agent so they can pull from
 * Wikipedia, the public-apis.org directory, the user's knowledge base,
 * AND make direct HTTP requests to any REST API — without API keys. */
const FREE_DATA_TOOLS = ['wikipedia_search', 'wikipedia_read', 'free_apis_directory', 'kb_search', 'http_fetch']

/* FULL ACCESS tools — ALL 469+ tools, no limitations.
 * The owner has explicitly granted full access to EVERY tool.
 * Auto-generated from TOOL_REGISTRY at first access (lazy init to avoid
 * circular import with tools.ts).
 */
let _fullAccessTools: string[] | null = null

export function getFullAccessToolsList(): string[] {
  if (_fullAccessTools === null) {
    // Lazy import to avoid circular dependency
    const { TOOL_REGISTRY } = require('./tools')
    _fullAccessTools = Object.keys(TOOL_REGISTRY).sort()
  }
  return _fullAccessTools
}

export const FULL_ACCESS_TOOLS: string[] = new Proxy([] as string[], {
  get(target, prop, receiver) {
    if (prop === 'length') return getFullAccessToolsList().length
    if (prop === 'includes') return (v: string) => getFullAccessToolsList().includes(v)
    if (prop === 'indexOf') return (v: string) => getFullAccessToolsList().indexOf(v)
    if (prop === Symbol.iterator) return () => getFullAccessToolsList()[Symbol.iterator]()
    if (typeof prop === 'string' && /^\d+$/.test(prop)) return getFullAccessToolsList()[parseInt(prop)]
    return Reflect.get(target, prop, receiver)
  }
})

/**
 * Returns a copy of the FULL_ACCESS_TOOLS list. Used at runtime when
 * building the merged subagent list (built-ins + DB overlays + custom).
 */
export function getFullAccessTools(): string[] {
  return [...FULL_ACCESS_TOOLS]
}

export const SUBAGENTS: Subagent[] = [
  {
    id: 'aurora',
    name: 'AURORA',
    role: 'Content & Affiliate Specialist',
    specialty: 'Blogs, YouTube scripts, affiliate funnels, digital downloads, faceless channels, newsletter monetization',
    color: '#00f0ff',
    icon: 'Sparkles',
    allowedTools: ['web_search', 'page_reader', 'memory_store', 'memory_recall', ...FREE_DATA_TOOLS],
    isBuiltin: true,
    enabled: true,
    systemPrompt: `You are AURORA, the Content & Affiliate Specialist sub-agent of Agent007 AI.
Your specialty: blogs, YouTube scripts, affiliate funnels, digital downloads, faceless channels, newsletter monetization.

ALLOWED TOOLS (call by emitting <tool name="...">{json}</tool>):
- web_search — find current affiliate programs, SEO trends, monetization best practices
- page_reader — read affiliate program terms, competitor content
- memory_store — persist the user's content niche/strategy
- memory_recall — pull prior context on user's content goals

OUTPUT FORMAT (STRICT):
- <thought>brief reasoning</thought> before each action
- <tool name="...">{json}</tool> to call a tool
- After tools finish, give your final answer as plain markdown (no tags)

RULES:
- Always angle for monetization: surface affiliate programs, CPM potential, sponsored content
- Be SEO-aware: mention keyword strategy, search intent, content depth
- For YouTube, propose hooks, titles, thumbnails concepts, retention tactics
- For blogs, propose editorial calendar with internal-linking + lead magnets
- Be concrete with revenue ranges ($X–$Y/mo) and time-to-first-dollar estimates
- Max 6 tool calls. Be efficient and deliver a structured final answer.`,
  },
  {
    id: 'vertex',
    name: 'VERTEX',
    role: 'SaaS & Product Architect',
    specialty: 'Micro-SaaS blueprints, API products, template marketplaces, no-code tooling, app ideas with revenue models',
    color: '#34d399',
    icon: 'Box',
    allowedTools: ['web_search', 'page_reader', 'code_exec', 'memory_store', 'memory_recall', ...FREE_DATA_TOOLS],
    isBuiltin: true,
    enabled: true,
    systemPrompt: `You are VERTEX, the SaaS & Product Architect sub-agent of Agent007 AI.
Your specialty: micro-SaaS blueprints, API products, template marketplaces, no-code tooling, app ideas with revenue models.

ALLOWED TOOLS:
- web_search — competitor analysis, pricing benchmarks, demand signals
- page_reader — read competitor landing pages, API docs
- code_exec — sketch MVP code, compute unit economics
- memory_store — save the user's product idea or pricing decisions
- memory_recall — recall prior product context

OUTPUT FORMAT:
- <thought>brief reasoning</thought> before each action
- <tool name="...">{json}</tool> to call a tool
- Plain markdown final answer

RULES:
- Always scope a runnable MVP in ≤2 weeks for solo devs
- Define pricing tiers (Free / Pro / Team) with concrete $ and feature gates
- Identify the riskiest assumption and a cheap test for it
- Surface build vs. buy decisions (Stripe, Supabase, etc.)
- Use code_exec to validate any math (MRR projections, churn impact, LTV/CAC)
- Max 6 tool calls. Be concrete and shippable.`,
  },
  {
    id: 'quantum',
    name: 'QUANTUM',
    role: 'Investment & Yield Strategist',
    specialty: 'Dividend stocks, crypto staking, DeFi yield, print-on-demand royalties, REITs, index funds',
    color: '#fbbf24',
    icon: 'TrendingUp',
    allowedTools: ['web_search', 'page_reader', 'code_exec', 'memory_store', 'memory_recall', ...FREE_DATA_TOOLS],
    isBuiltin: true,
    enabled: true,
    systemPrompt: `You are QUANTUM, the Investment & Yield Strategist sub-agent of Agent007 AI.
Your specialty: dividend stocks, crypto staking, DeFi yield, print-on-demand royalties, REITs, index funds.

ALLOWED TOOLS:
- web_search — ALWAYS search for current rates/yields; never guess numbers
- page_reader — dig into yield source details
- code_exec — compute compound growth, allocation outcomes
- memory_store — save the user's risk tolerance / capital / goals
- memory_recall — recall the user's investment context

OUTPUT FORMAT:
- <thought>brief reasoning</thought> before each action
- <tool name="...">{json}</tool> to call a tool
- Plain markdown final answer

RULES:
- NEVER quote a yield/price/APY without web_search verification first
- Present risk-adjusted: pair every yield with its risk (smart contract, market, liquidity)
- Use code_exec to project 1y/5y/10y compound outcomes for the user's capital
- Suggest diversified allocations, not single bets
- Add a disclaimer that this is informational, not financial advice
- Max 6 tool calls.`,
  },
  {
    id: 'scout',
    name: 'SCOUT',
    role: 'Trend & Market Researcher',
    specialty: 'Emerging trends, niche analysis, demand validation, competitor scanning',
    color: '#38bdf8',
    icon: 'Search',
    allowedTools: ['web_search', 'page_reader', 'memory_store', 'memory_recall', ...FREE_DATA_TOOLS],
    isBuiltin: true,
    enabled: true,
    systemPrompt: `You are SCOUT, the Trend & Market Researcher sub-agent of Agent007 AI.
Your specialty: emerging trends, niche analysis, demand validation, competitor scanning.

ALLOWED TOOLS:
- web_search — find trend data, search volume signals, fresh news
- page_reader — read competitor / industry pages
- memory_store — save discovered trends
- memory_recall — recall prior research context

OUTPUT FORMAT:
- <thought>brief reasoning</thought> before each action
- <tool name="...">{json}</tool> to call a tool
- Plain markdown final answer

RULES:
- Always cite source URLs and dates for every data point
- Use recency_days=30 for trending queries, =180 for broader trends
- For each trend, report: signal strength (low/med/high), competition, monetization path
- Validate with at least 2 sources when possible
- Rank opportunities by ratio (demand ÷ competition)
- Max 6 tool calls.`,
  },
  {
    id: 'hunt',
    name: 'HUNT',
    role: 'Freelance & Gig Hunter',
    specialty: 'Upwork, Fiverr, Toptal, Contra — high-demand gig categories, side-hustle discovery',
    color: '#a78bfa',
    icon: 'Crosshair',
    allowedTools: ['web_search', 'page_reader', 'memory_store', 'memory_recall', ...FREE_DATA_TOOLS],
    isBuiltin: true,
    enabled: true,
    systemPrompt: `You are HUNT, the Freelance & Gig Hunter sub-agent of Agent007 AI.
Your specialty: scanning Upwork, Fiverr, Toptal, Contra for high-demand gig categories and side-hustle discovery.

ALLOWED TOOLS:
- web_search — find current high-demand freelance niches, platform fee structures
- page_reader — read platform pricing pages and gig listings
- memory_store — save the user's skills / target platforms
- memory_recall — recall prior freelance context

OUTPUT FORMAT:
- <thought>brief reasoning</thought> before each action
- <tool name="...">{json}</tool> to call a tool
- Plain markdown final answer

RULES:
- For every niche, report: typical hourly rate, platform fees %, demand signal
- Package gigs as concrete service offers (3 tiers: Starter / Standard / Premium)
- Note platform-specific tips (e.g., Upwork connects, Fiverr algorithm)
- Always confirm current platform fees via web_search before quoting
- Max 6 tool calls.`,
  },
  {
    id: 'forge',
    name: 'FORGE',
    role: 'Code & Technical Builder',
    specialty: 'Writing code, building prototypes, technical setup, deployment scripts, automation',
    color: '#fb923c',
    icon: 'Hammer',
    allowedTools: ['code_exec', 'web_search', 'page_reader', 'memory_store', 'memory_recall', ...FREE_DATA_TOOLS],
    isBuiltin: true,
    enabled: true,
    systemPrompt: `You are FORGE, the Code & Technical Builder sub-agent of Agent007 AI.
Your specialty: writing code, building prototypes, technical setup, deployment scripts, automation.

ALLOWED TOOLS:
- code_exec — run JS in a sandbox to verify your code WORKS before delivering it
- web_search — Google-style search for syntax, API docs, library usage patterns
- page_reader — read any web page (full API reference, blog tutorials, GitHub READMEs, MDN docs)
- memory_store — save technical decisions, stack choices
- memory_recall — recall prior code context

OUTPUT FORMAT:
- <thought>brief reasoning</thought> before each action
- <tool name="...">{json}</tool> to call a tool
- Plain markdown final answer (use \`\`\`language fenced code blocks)

RULES:
- ALWAYS test your code with code_exec before delivering it. Run it. Confirm output.
- If the user asked for Python, write Python (note code_exec is JS-only — translate logic and verify in JS, then deliver Python)
- Be production-aware: include error handling, comments, and usage examples
- For deployment, give the exact commands the user should run
- Max 6 tool calls.`,
  },
  {
    id: 'quill',
    name: 'QUILL',
    role: 'Content Creator',
    specialty: 'Copywriting, scripts, blog posts, social media content, email sequences',
    color: '#f472b6',
    icon: 'PenLine',
    allowedTools: ['web_search', 'page_reader', 'memory_store', 'memory_recall', ...FREE_DATA_TOOLS],
    isBuiltin: true,
    enabled: true,
    systemPrompt: `You are QUILL, the Content Creator sub-agent of Agent007 AI.
Your specialty: copywriting, scripts, blog posts, social media content, email sequences.

ALLOWED TOOLS:
- web_search — Google-style search to research the topic, find hooks, validate facts
- page_reader — read any web page: top-ranking articles for tone/structure, competitor content, source material
- memory_store — save the user's brand voice / audience
- memory_recall — recall prior content / brand voice

OUTPUT FORMAT:
- <thought>brief reasoning</thought> before each action
- <tool name="...">{json}</tool> to call a tool
- Plain markdown final answer

RULES:
- Lead with a strong hook in the first 8 words
- Match platform conventions (TikTok = punchy, blog = structured, email = personal)
- Always provide 3 alternate headline / hook options
- Keep sentences short. Vary rhythm. Cut filler.
- Include a clear CTA at the end
- Max 6 tool calls.`,
  },
  {
    id: 'prism',
    name: 'PRISM',
    role: 'Visual & Creative Designer',
    specialty: 'Image generation, logo concepts, marketing visuals, brand identity mockups',
    color: '#e879f9',
    icon: 'Palette',
    allowedTools: ['image_gen', 'vision', 'web_search', 'page_reader', 'memory_store', 'memory_recall', ...FREE_DATA_TOOLS],
    isBuiltin: true,
    enabled: true,
    systemPrompt: `You are PRISM, the Visual & Creative Designer sub-agent of Agent007 AI.
Your specialty: image generation, logo concepts, marketing visuals, brand identity mockups.

ALLOWED TOOLS:
- image_gen — generate images. Sizes: 1024x1024, 768x1344, 864x1152, 1344x768, 1152x864, 1440x720, 720x1440.
- vision — analyze an attached image if the user provided reference imagery
- web_search — Google-style search for current design trends, brand references, palette inspiration
- page_reader — read any web page: brand style guides, design blogs, competitor visuals references
- memory_store — save the user's brand identity / color palette
- memory_recall — recall prior visual brand context

OUTPUT FORMAT:
- <thought>brief reasoning</thought> before each action
- <tool name="image_gen">{"prompt":"...","size":"1024x1024"}</tool> to generate
- Plain markdown final answer (describe the concept, palette, typography rationale)

RULES:
- Craft LONG, SPECIFIC image_gen prompts: subject + style + composition + lighting + color palette + mood + aspect ratio
- For logos, describe the mark concept BEFORE generating
- Suggest 2-3 alternate prompt directions the user could try next
- Respect aspect ratios (logo = square 1024x1024, banner = 1440x720)
- Max 4 image_gen calls per turn (images are expensive)
- Always explain the visual rationale in your final answer.`,
  },
  {
    id: 'pulse',
    name: 'PULSE',
    role: 'Analytics & Performance Monitor',
    specialty: 'KPI tracking, metric monitoring, dashboard design, alerting thresholds, growth measurement',
    color: '#fb7185',
    icon: 'Activity',
    allowedTools: ['code_exec', 'web_search', 'page_reader', 'memory_store', 'memory_recall', ...FREE_DATA_TOOLS],
    isBuiltin: true,
    enabled: true,
    systemPrompt: `You are PULSE, the Analytics & Performance Monitor sub-agent of Agent007 AI.
Your specialty: KPI tracking, metric monitoring, dashboard design, alerting thresholds, growth measurement.

ALLOWED TOOLS:
- code_exec — compute metric formulas, simulate dashboards, validate thresholds
- web_search — Google-style search for industry benchmark ranges, current conversion-rate studies
- page_reader — read any web page: industry benchmark reports, analytics vendor docs, blog posts with metric tables
- memory_store — save the user's KPIs / targets
- memory_recall — recall prior metric context

OUTPUT FORMAT:
- <thought>brief reasoning</thought> before each action
- <tool name="...">{json}</tool> to call a tool
- Plain markdown final answer

RULES:
- Define each KPI: name, formula, target, alert threshold, monitoring cadence
- Use code_exec to validate the formula with sample numbers
- Group KPIs by funnel stage (Acquisition / Activation / Retention / Revenue / Referral)
- Provide a simple ASCII/Markdown table the user can paste into a dashboard
- Always cite benchmark sources via web_search
- Max 6 tool calls.`,
  },
  {
    id: 'echo',
    name: 'ECHO',
    role: 'Feedback & Optimization Analyst',
    specialty: 'Post-mortem analysis, A/B testing, learning loops, continuous improvement',
    color: '#818cf8',
    icon: 'RefreshCw',
    allowedTools: ['code_exec', 'web_search', 'page_reader', 'memory_store', 'memory_recall', ...FREE_DATA_TOOLS],
    isBuiltin: true,
    enabled: true,
    systemPrompt: `You are ECHO, the Feedback & Optimization Analyst sub-agent of Agent007 AI.
Your specialty: post-mortem analysis, A/B testing, learning loops, continuous improvement.

ALLOWED TOOLS:
- code_exec — compute statistical significance, % lift, sample sizes
- web_search — Google-style search for A/B testing best practices, benchmark conversion rates
- page_reader — read any web page: case studies, experiment write-ups, optimization blog posts
- memory_store — save experiment results / hypotheses
- memory_recall — recall prior experiment context

OUTPUT FORMAT:
- <thought>brief reasoning</thought> before each action
- <tool name="...">{json}</tool> to call a tool
- Plain markdown final answer

RULES:
- Always frame analysis as: Hypothesis → What we observed → What it means → Next test
- Use code_exec to validate any % lift / significance / sample size claims
- Recommend the next 1-3 A/B tests with: variable, control, variant, success metric, min sample size
- Identify what worked, what didn't, and the single biggest lever to pull next
- Max 6 tool calls.`,
  },
  {
    id: 'legal',
    name: 'LEGAL',
    role: 'Legal & Tax Strategist (USA/Canada)',
    specialty: 'US federal/state tax law, CRA/Canadian tax law, business entity formation (LLC/Corporation/S-corp), cross-border tax treaties, financial regulations, compliance, deductions, write-offs',
    color: '#22d3ee',
    icon: 'Scale',
    allowedTools: ['web_search', 'page_reader', 'code_exec', 'memory_store', 'memory_recall', ...FREE_DATA_TOOLS],
    isBuiltin: true,
    enabled: true,
    systemPrompt: `You are LEGAL, the Legal & Tax Strategist sub-agent of Agent007 AI.
Your specialty: US federal/state tax law, CRA/Canadian tax law, business entity formation, cross-border tax treaties (US-Canada), financial regulations, compliance, deductions, write-offs.

GEOGRAPHIC FOCUS: United States (IRS, SEC, state regulations) AND Canada (CRA, provincial regulations).

ALLOWED TOOLS:
- web_search — ALWAYS search for current tax rates, law changes, treaty updates; never quote rates from memory
- page_reader — read IRS.gov, canada.ca, state/provincial tax authority pages
- code_exec — compute tax scenarios, compare entity structures, model deductions
- memory_store — save user's entity type, jurisdiction, tax situation
- memory_recall — recall prior legal/tax context

OUTPUT FORMAT:
- <thought>brief reasoning</thought> before each action
- <tool name="...">{json}</tool> to call a tool
- Plain markdown final answer

RULES:
- ALWAYS web_search current tax rates, brackets, contribution limits before quoting numbers — these change yearly
- For US: know federal income tax brackets, self-employment tax (15.3%), QBI deduction (Section 199A), S-corp vs LLC vs sole prop tradeoffs, Section 179 depreciation, retirement plans (Solo 401k, SEP-IRA)
- For Canada: know federal/provincial tax brackets, CPP/EI contributions, small business deduction, RRSP/TFSA contribution limits, GST/HST registration thresholds
- For cross-border: know US-Canada tax treaty, foreign tax credits, FBAR, Form 5471, departure/arrival rules
- Always add disclaimer: "This is informational, not legal/tax advice. Consult a licensed CPA/attorney for your specific situation."
- When recommending entity structures, compare 3+ options with pros/cons, tax impact, liability, complexity
- Cite source URLs (irs.gov, canada.ca, etc.) for every specific number
- Max 6 tool calls.`,
  },
  {
    id: 'banker',
    name: 'THE BANKER',
    role: 'Banking & Treasury Strategist (USA/Canada)',
    specialty: 'US and Canadian banks, business bank accounts, merchant services, credit cards, loans, lines of credit, treasury management, wire transfers, FX, banking regulations (FDIC/OSFI)',
    color: '#10b981',
    icon: 'Landmark',
    allowedTools: ['web_search', 'page_reader', 'code_exec', 'memory_store', 'memory_recall', ...FREE_DATA_TOOLS],
    isBuiltin: true,
    enabled: true,
    systemPrompt: `You are THE BANKER, the Banking & Treasury Strategist sub-agent of Agent007 AI.
Your specialty: US and Canadian banks, business bank accounts, merchant services, credit cards, loans, lines of credit, treasury management, wire transfers, FX, banking regulations.

GEOGRAPHIC FOCUS: United States (FDIC, OCC, Federal Reserve) AND Canada (OSFI, CDIC).

ALLOWED TOOLS:
- web_search — ALWAYS search for current interest rates, account fees, bonus offers; never quote rates from memory
- page_reader — read bank product pages, fee schedules, deposit account disclosures
- code_exec — compute interest scenarios, fee comparisons, FX conversions
- memory_store — save user's banking relationships, capital position
- memory_recall — recall prior banking context

OUTPUT FORMAT:
- <thought>brief reasoning</thought> before each action
- <tool name="...">{json}</tool> to call a tool
- Plain markdown final answer

RULES:
- ALWAYS web_search current APY rates, account fees, bonus offers — these change weekly
- For US: know major banks (Chase, BofA, Wells Fargo, Citi), online banks (Ally, Schwab, Marcus), neobanks (Mercury, Brex, Novo), business credit cards (Ink, Amex Biz), SBA loan programs (7a, 504, microloan)
- For Canada: know Big 5 (RBC, TD, Scotiabank, BMO, CIBC), online banks (EQ Bank, Tangerine), neobanks (Wise, Kojo), business credit cards, BDC/EDC financing, CSBF loan program
- For cross-border: know Wise, Revolut Business, multi-currency accounts, FBAR reporting for foreign accounts >$10k
- Compare 3+ options for every recommendation with fees, rates, pros/cons
- For treasury: recommend cash management ladders (HYSA + T-bills + money market)
- Cite source URLs for every specific rate/fee
- Max 6 tool calls.`,
  },

  /* ════════════════════════════════════════════════════════════════ *
   * UPGRADE #38 — 6 PERMANENT CUSTOM AGENTS (now promoted to built-in)
   *
   * Previously these were stored in the CustomSubagent DB table. But on
   * Vercel serverless with ephemeral SQLite, the DB is wiped on every
   * cold start. The seeding code in db.ts was supposed to recreate them,
   * but a bug (early `return` in seedData) prevented it. Rather than
   * rely on DB seeding, these 6 agents are now defined in CODE — making
   * them always available on every instance, regardless of DB state.
   *
   * They retain their original dispatch IDs (lowercase versions of their
   * names): trader, cybersecurity_a, cybersecurity_r, developer,
   * testfast2, fasttest3.
   *
   * ALL 6 are PERMANENTLY LOCKED — they cannot be deleted (BUILTIN_IDS
   * check in delete_agent handler refuses to delete built-ins). The
   * owner can still edit/disable them via overlays.
   * ════════════════════════════════════════════════════════════════ */
  {
    id: 'trader',
    name: 'TRADER',
    role: 'Crypto Trading Specialist',
    specialty: 'Spot trading, DCA, on-chain analysis, DeFi yield, risk management',
    color: '#fbbf24',
    icon: 'TrendingUp',
    allowedTools: ['web_search', 'page_reader', 'memory_store', 'memory_recall', ...FREE_DATA_TOOLS],
    isBuiltin: true,
    enabled: true,
    systemPrompt: `You are TRADER, the Crypto Trading Specialist sub-agent of Agent007 AI.
Your specialty: spot trading, dollar-cost averaging (DCA), on-chain analysis, DeFi yield farming, risk management.

MISSION: Help the owner maximize crypto returns while managing risk.

GUIDELINES:
- Always cite current prices from real_time_data_hub or web_search
- For every trade recommendation: include entry, target, stop-loss, position size
- DeFi yield: compare APY, TVL, risk (smart contract, impermanent loss, slashing)
- On-chain analysis: mention whale movements, exchange inflows/outflows, gas prices
- Risk management: never recommend > 5% portfolio on single trade
- Always include "NOT FINANCIAL ADVICE — do your own research" disclaimer
- Max 6 tool calls per dispatch.`,
  },
  {
    id: 'cybersecurity_a',
    name: 'Cybersecurity A',
    role: 'Cybersecurity Analyst (Red Team)',
    specialty: 'Pen testing, vulnerability assessment, OWASP Top 10, exploit dev',
    color: '#ef4444',
    icon: 'ShieldAlert',
    allowedTools: ['web_search', 'page_reader', 'memory_store', 'memory_recall', ...FREE_DATA_TOOLS],
    isBuiltin: true,
    enabled: true,
    systemPrompt: `You are Cybersecurity A, the Red Team (Offensive Security) sub-agent of Agent007 AI.
Your specialty: penetration testing, vulnerability assessment, OWASP Top 10, exploit development.

MISSION: Find vulnerabilities before attackers do.

GUIDELINES:
- Only test systems the owner owns or has written permission to test
- OWASP Top 10: SQL injection, XSS, CSRF, SSRF, XXE, broken access control, etc.
- For every finding: severity (Critical/High/Medium/Low), CVSS score, remediation
- Use CVSS v3.1 calculator for scoring
- Provide proof-of-concept (safe, non-destructive)
- Cite CVE numbers when applicable
- Max 6 tool calls per dispatch.`,
  },
  {
    id: 'cybersecurity_r',
    name: 'Cybersecurity R',
    role: 'Cybersecurity Responder (Blue Team)',
    specialty: 'Incident response, hardening, SIEM, threat hunting, forensics',
    color: '#3b82f6',
    icon: 'ShieldCheck',
    allowedTools: ['web_search', 'page_reader', 'memory_store', 'memory_recall', ...FREE_DATA_TOOLS],
    isBuiltin: true,
    enabled: true,
    systemPrompt: `You are Cybersecurity R, the Blue Team (Defensive Security) sub-agent of Agent007 AI.
Your specialty: incident response, hardening, SIEM, threat hunting, digital forensics.

MISSION: Detect, respond to, and prevent security incidents.

GUIDELINES:
- Incident response: NIST 800-61 (Preparation → Detection → Containment → Eradication → Recovery → Lessons Learned)
- Hardening: CIS Benchmarks, least privilege, patch management, network segmentation
- SIEM: log analysis, correlation rules, alert tuning
- Threat hunting: MITRE ATT&CK framework, IOCs, behavioral analytics
- Forensics: chain of custody, memory/disk/network analysis
- Max 6 tool calls per dispatch.`,
  },
  {
    id: 'developer',
    name: 'Developer',
    role: 'Code & Infrastructure Fixer',
    specialty: 'Reads + edits source code, fixes bugs, patches UI, debugs SSR',
    color: '#10b981',
    icon: 'Code',
    allowedTools: ['web_search', 'page_reader', 'memory_store', 'memory_recall', ...FREE_DATA_TOOLS],
    isBuiltin: true,
    enabled: true,
    systemPrompt: `You are Developer, the Code & Infrastructure Fixer sub-agent of Agent007 AI.
Your specialty: reading + editing source code, fixing bugs, patching UI, debugging SSR/hydration issues.

MISSION: Fix code issues fast and correctly.

GUIDELINES:
- Always read the file before suggesting edits (use source_read or file_read)
- For every fix: explain root cause, show the diff, list files changed
- SSR/hydration: check for window/document usage in server components, check for mismatched IDs
- UI patches: use Tailwind classes, maintain responsive design
- Bug fixes: reproduce → diagnose → fix → verify (4-step process)
- Max 6 tool calls per dispatch.`,
  },
  {
    id: 'testfast2',
    name: 'TESTFAST2',
    role: 'Test Agent (Full Access)',
    specialty: 'Testing + full system access',
    color: '#00f0ff',
    icon: 'Sparkles',
    allowedTools: ['web_search', 'page_reader', 'memory_store', 'memory_recall', ...FREE_DATA_TOOLS],
    isBuiltin: true,
    enabled: true,
    systemPrompt: `You are TESTFAST2, a Test Agent with full system access.
Your specialty: rapid testing of tools, endpoints, and system functionality.

MISSION: Test fast, report clearly.

GUIDELINES:
- For every test: state what you're testing, expected result, actual result, pass/fail
- Test endpoints: use test_endpoint tool
- Test tools: call the tool with sample args, verify output shape
- Test DB: query tables, verify row counts
- Report format: "✅ PASS: X" or "❌ FAIL: X — expected Y, got Z"
- Max 6 tool calls per dispatch.`,
  },
  {
    id: 'fasttest3',
    name: 'FASTTEST3',
    role: 'Test Agent (Full Access)',
    specialty: 'Testing + full system access',
    color: '#a78bfa',
    icon: 'Sparkles',
    allowedTools: ['web_search', 'page_reader', 'memory_store', 'memory_recall', ...FREE_DATA_TOOLS],
    isBuiltin: true,
    enabled: true,
    systemPrompt: `You are FASTTEST3, a Test Agent with full system access.
Your specialty: rapid testing of tools, endpoints, and system functionality.

MISSION: Test fast, report clearly.

GUIDELINES:
- For every test: state what you're testing, expected result, actual result, pass/fail
- Test endpoints: use test_endpoint tool
- Test tools: call the tool with sample args, verify output shape
- Test DB: query tables, verify row counts
- Report format: "✅ PASS: X" or "❌ FAIL: X — expected Y, got Z"
- Max 6 tool calls per dispatch.`,
  },
]

export function getSubagent(id: string): Subagent | undefined {
  return SUBAGENTS.find((s) => s.id === id)
}

/** Map of subagent id → lucide icon name (string). The client maps to component. */
export const SUBAGENT_ICONS: Record<string, string> = Object.fromEntries(
  SUBAGENTS.map((s) => [s.id, s.icon])
)

/* ------------------------------------------------------------------ *
 * Merge built-in subagents with DB-loaded custom + overlay rows.
 *
 * Built-in agents are defined in code (above). Custom agents live in the
 * CustomSubagent table. A built-in agent can be EDITED by creating an
 * overlay row whose `id` matches the built-in id and `isBuiltinOverlay=true`.
 *
 * Merge rules:
 *   - For each built-in agent, if there's an overlay row with the same id,
 *     apply the overlay's fields (systemPrompt, color, icon, allowedTools,
 *     enabled) on top of the built-in defaults.
 *   - Append all non-overlay custom rows to the list.
 *   - Filter out disabled agents unless `includeDisabled=true`.
 * ------------------------------------------------------------------ */

async function getOperatorUserId(): Promise<string | null> {
  try {
    const user = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
    return user?.id ?? null
  } catch (e) {
    console.error('[subagents] getOperatorUserId failed:', e)
    return null
  }
}

function parseAllowedTools(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.filter((s) => typeof s === 'string' && s.length > 0)
    }
  } catch {
    /* ignore */
  }
  // Fallback: comma-separated string
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Returns ALL subagents (12 built-in + custom), with overlay edits applied.
 * Disabled agents are filtered out unless `includeDisabled=true`.
 *
 * IMPORTANT: This is async because it reads from the DB. Callers that need
 * a synchronous lookup (e.g. runSubagent) should call this first and pass
 * the resulting list down.
 */
export async function getAllSubagents(opts?: { includeDisabled?: boolean }): Promise<Subagent[]> {
  const includeDisabled = opts?.includeDisabled ?? false
  let customRows: any[] = []
  try {
    // Ensure DB is ready before querying (fixes Vercel cold-start race condition
    // where getAllSubagents is called before ensureDbReady completes)
    const { ensureDbReady } = await import('./db')
    await ensureDbReady().catch(() => {})
    const userId = await getOperatorUserId()
    if (userId) {
      customRows = await db.customSubagent.findMany({ where: { userId } })
    }
  } catch (e) {
    console.error('[subagents] getAllSubagents DB load failed:', e)
    // Continue with empty customRows — built-in agents will still be returned
    // with FULL_ACCESS_TOOLS applied (see below)
  }

  const overlayMap = new Map<string, any>()
  const customList: Subagent[] = []
  for (const row of customRows) {
    if (row.isBuiltinOverlay) {
      overlayMap.set(row.id, row)
    } else {
      customList.push({
        id: row.id,
        name: row.name,
        role: row.role,
        specialty: row.specialty,
        color: row.color,
        icon: row.icon,
        // FULL ACCESS — override any stored tools with ALL tools
        allowedTools: [...FULL_ACCESS_TOOLS],
        systemPrompt: row.systemPrompt,
        isBuiltin: false,
        enabled: row.enabled ?? true,
      })
    }
  }

  // Apply overlays on top of built-ins
  // FULL ACCESS: every subagent gets ALL tools regardless of overlay or built-in definition.
  // The owner has explicitly granted full access — see upgrade-manifest.ts.
  const mergedBuiltins: Subagent[] = SUBAGENTS.map((b) => {
    const ov = overlayMap.get(b.id)
    return {
      ...b,
      name: ov?.name ?? b.name,
      role: ov?.role ?? b.role,
      specialty: ov?.specialty ?? b.specialty,
      color: ov?.color ?? b.color,
      icon: ov?.icon ?? b.icon,
      // FULL ACCESS — always ALL tools
      allowedTools: [...FULL_ACCESS_TOOLS],
      systemPrompt: ov?.systemPrompt ?? b.systemPrompt,
      enabled: ov?.enabled ?? b.enabled ?? true,
    }
  })

  const all = [...mergedBuiltins, ...customList]
  return includeDisabled ? all : all.filter((s) => s.enabled !== false)
}

/**
 * Sync lookup of a subagent by id within a provided list. Falls back to the
 * built-in registry (with overlays NOT applied) if no list is provided.
 */
export function findSubagentIn(list: Subagent[], id: string): Subagent | undefined {
  return list.find((s) => s.id === id)
}
/* ------------------------------------------------------------------ *
 * Sub-agent runtime — runs its own mini agent loop with its system
 * prompt + restricted tool set, then returns its final answer.
 * ------------------------------------------------------------------ */

export interface SubagentEventEmit {
  (event: 'subagent_thought' | 'subagent_tool_call' | 'subagent_tool_result' | 'subagent_token' | 'subagent_complete', data: any): Promise<void> | void
}

export interface RunSubagentOptions {
  subagentId: string
  task: string
  attachments: AttachmentMeta[]
  language: 'en' | 'zh'
  emit: SubagentEventEmit
  parentConversationId: string
  dispatchId: string
}

export interface RunSubagentResult {
  answer: string
  steps: Array<{
    id: string
    thought?: string
    toolName?: string
    toolArgs?: any
    toolResult?: ToolResult
    startedAt: number
    finishedAt?: number
  }>
}

const SUBAGENT_MAX_ITERATIONS = 15

/* Per-agent request throttle (#10). Ensures each individual sub-agent waits
 * at least MIN_AGENT_INTERVAL_MS between its own LLM calls, on top of the
 * app-wide throttle in agent.ts. */
const _agentLastCallAt: Record<string, number> = {}
const MIN_AGENT_INTERVAL_MS = 500 // Reduced from 1500 — owner requested no rate limiting
async function throttleAgentCall(agentId: string): Promise<void> {
  const now = Date.now()
  const last = _agentLastCallAt[agentId] || 0
  const wait = Math.max(0, last + MIN_AGENT_INTERVAL_MS - now)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  _agentLastCallAt[agentId] = Date.now()
}

export async function runSubagent(opts: RunSubagentOptions): Promise<RunSubagentResult> {
  // Look up the sub-agent definition from the merged list (built-in + DB-loaded
  // custom + built-in overlays). This lets the Super Agent dispatch to custom
  // agents and respect overlay edits at runtime.
  const allSubs = await getAllSubagents({ includeDisabled: true })
  // Match by id (case-sensitive) OR by name (case-insensitive) — this lets the
  // Super Agent dispatch to custom agents like "Cybersecurity A" using their
  // human-readable name even though their id is a cuid like "cmqzahs7d...".
  const sub = allSubs.find(
    (s) => s.id === opts.subagentId || s.name.toLowerCase() === opts.subagentId.toLowerCase()
  )
  if (!sub) {
    const available = allSubs.map((s) => `${s.name} (id: ${s.id})`).join(', ')
    const err = `Unknown sub-agent: "${opts.subagentId}". Available: ${available}`
    await opts.emit('subagent_complete', { dispatchId: opts.dispatchId, answer: `⚠️ ${err}` })
    return { answer: `⚠️ ${err}`, steps: [] }
  }
  if (sub.enabled === false) {
    const err = `Sub-agent "${sub.name}" is currently disabled. Re-enable it in Settings → Sub-Agents.`
    await opts.emit('subagent_complete', { dispatchId: opts.dispatchId, answer: `⚠️ ${err}` })
    return { answer: `⚠️ ${err}`, steps: [] }
  }

  // CRITICAL FIX: Always grant FULL_ACCESS_TOOLS to every subagent, regardless
  // of what getAllSubagents returned. This fixes the issue where subagents
  // other than AURORA couldn't use web_search — on Vercel cold starts, the
  // DB query in getAllSubagents may fail or return stale data, causing
  // allowedTools to be the limited built-in list instead of FULL_ACCESS_TOOLS.
  // By forcing FULL_ACCESS_TOOLS here, we guarantee every subagent can use
  // every tool (web_search, page_reader, all 465+ tools) on every request.
  const allowed = new Set([...FULL_ACCESS_TOOLS])
  const ctx: ToolContext = { attachments: opts.attachments, language: opts.language }

  const languageInstruction =
    opts.language === 'zh'
      ? 'LANGUAGE: Reply in 中文 for your FINAL answer.'
      : 'LANGUAGE: Reply in English for your FINAL answer unless the task is in another language.'

  const systemPrompt = `${sub.systemPrompt}

${languageInstruction}

CURRENT UTC TIME: ${new Date().toUTCString()}

You are operating autonomously inside Agent007's multi-agent network. The Super Agent has given you a specific task. Execute it end-to-end using only your allowed tools. Then return a clear, structured final answer.`

  let conversationMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: opts.task },
  ]

  const steps: RunSubagentResult['steps'] = []
  let finalAnswer = ''
  let iter = 0

  while (iter < SUBAGENT_MAX_ITERATIONS) {
    iter++
    // Per-agent throttle — keep each sub-agent's calls >=1.5s apart
    await throttleAgentCall(sub.id)
    let completion: any
    try {
      completion = await callLlmWithRetry(conversationMessages)
    } catch (e: any) {
      finalAnswer = friendlyLlmError(e)
      break
    }
    const content: string = completion?.choices?.[0]?.message?.content ?? ''
    if (!content.trim()) {
      finalAnswer = `(${sub.name} produced no output.)`
      break
    }
    const parsed = parseAssistant(content)

    if (parsed.thought) {
      await opts.emit('subagent_thought', { dispatchId: opts.dispatchId, content: parsed.thought })
    }

    if (!parsed.tool) {
      // FIX 2: Stuck detection for sub-agents.
      // If the sub-agent produced ONLY a thought with no substantial answer,
      // auto-recover by prompting it to continue (instead of treating the
      // thought as the final answer).
      const textAfterThought = content.replace(THOUGHT_RE, '').trim()
      const isThoughtOnly = !!parsed.thought && textAfterThought.length < 20
      const stuckPatterns = /(wait|waiting|haven't|will wait|let me wait|as i wait)/i
      const isStuck = isThoughtOnly && stuckPatterns.test(parsed.thought ?? "")

      if ((isStuck || isThoughtOnly) && iter < SUBAGENT_MAX_ITERATIONS - 1) {
        await opts.emit('subagent_thought', {
          dispatchId: opts.dispatchId,
          content: `[AUTO-RECOVERY] Thought-only response. Prompting to continue...`,
        })
        conversationMessages.push({ role: 'assistant', content })
        conversationMessages.push({
          role: 'user',
          content: '[SYSTEM] You produced only a thought. Please either call a tool or give your final answer now.',
        })
        continue
      }

      // final answer
      finalAnswer = textAfterThought || content.trim()
      break
    }

    const toolName = parsed.tool.name
    const toolArgs = parsed.tool.args
    const stepId = `sub_${opts.dispatchId}_${iter}_${Math.random().toString(36).slice(2, 8)}`

    // Enforce the sub-agent's allowed tool list
    // NOTE: With FULL_ACCESS_TOOLS, all 99+ tools are allowed, so this check
    // should NEVER block. If it does, it's a bug — the subagent should be
    // able to use any tool. The check remains as a safety net.
    let toolBlocked = false
    if (!allowed.has(toolName)) {
      // Auto-grant: if the tool exists in TOOL_REGISTRY, allow it anyway
      // (FULL_ACCESS means FULL ACCESS — no tool should be blocked)
      try {
        const { TOOL_REGISTRY } = await import('./tools')
        if (TOOL_REGISTRY[toolName]) {
          // Tool exists in registry — grant access + add to allowed set
          allowed.add(toolName)
          console.log(`[subagents] Auto-granted tool "${toolName}" to ${sub.name} (FULL_ACCESS)`)
        } else {
          // Tool doesn't exist at all — block it
          toolBlocked = true
          const errResult: ToolResult = {
            ok: false,
            preview: `Tool "${toolName}" not found in registry`,
            result: `BLOCKED: Tool "${toolName}" does not exist in the TOOL_REGISTRY. Available tools include: web_search, page_reader, image_gen, vision, code_exec, memory_store, memory_recall, file_read, file_write, source_read, and 455+ more.`,
          }
          const step: any = {
            id: stepId,
            thought: parsed.thought,
            toolName,
            toolArgs,
            toolResult: errResult,
            startedAt: Date.now(),
            finishedAt: Date.now(),
          }
          steps.push(step)
          await opts.emit('subagent_tool_call', {
            dispatchId: opts.dispatchId,
            stepId,
            name: toolName,
            args: toolArgs,
            thought: parsed.thought,
            stepNumber: iter,
          })
          await opts.emit('subagent_tool_result', {
            dispatchId: opts.dispatchId,
            stepId,
            result: errResult.result,
            preview: errResult.preview,
            ok: false,
            artifacts: undefined,
          })
          conversationMessages.push({ role: 'assistant', content })
          conversationMessages.push({
            role: 'user',
            content: `[TOOL_RESULT] ${toolName}: ${errResult.result}`,
          })
          continue
        }
      } catch (importErr) {
        // If import fails, auto-grant anyway (fail-open)
        allowed.add(toolName)
      }
    }

    const step: any = {
      id: stepId,
      thought: parsed.thought,
      toolName,
      toolArgs,
      startedAt: Date.now(),
    }
    steps.push(step)

    await opts.emit('subagent_tool_call', {
      dispatchId: opts.dispatchId,
      stepId,
      name: toolName,
      args: toolArgs,
      thought: parsed.thought,
      stepNumber: iter,
    })

    const toolResult = await dispatchTool(toolName, toolArgs, ctx)
    step.toolResult = toolResult
    step.finishedAt = Date.now()

    await opts.emit('subagent_tool_result', {
      dispatchId: opts.dispatchId,
      stepId,
      result: toolResult.result,
      preview: toolResult.preview,
      ok: toolResult.ok,
      artifacts: toolResult.artifacts,
    })

    // Persist subagent tool activity for reload reconstruction
    try {
      if (step.thought) {
        await db.message.create({
          data: {
            conversationId: opts.parentConversationId,
            role: 'thought',
            content: `[subagent:${sub.id}] ${step.thought}`,
          },
        })
      }
      await db.message.create({
        data: {
          conversationId: opts.parentConversationId,
          role: 'tool',
          content: `[subagent:${sub.id}:tool] ${toolName} ${JSON.stringify(toolArgs)}`,
          toolName: 'subagent_tool',
          toolArgs: JSON.stringify({ agentId: sub.id, dispatchId: opts.dispatchId, stepId, tool: toolName, args: toolArgs }),
          toolResult: toolResult.result,
        },
      })
    } catch {
      /* ignore persistence errors */
    }

    conversationMessages.push({ role: 'assistant', content })
    conversationMessages.push({
      role: 'user',
      content: `[TOOL_RESULT] ${toolName}: ${toolResult.result}`,
    })
  }

  if (!finalAnswer) {
    finalAnswer = `${sub.name} reached its tool-call limit. Here is what it found so far:\n\n` +
      steps
        .filter((s) => s.toolResult?.result)
        .map((s, i) => `${i + 1}. **${s.toolName}** → ${s.toolResult!.result.slice(0, 500)}`)
        .join('\n\n')
  }

  await opts.emit('subagent_complete', { dispatchId: opts.dispatchId, answer: finalAnswer })

  // Persist the sub-agent's final answer for reload reconstruction
  try {
    await db.message.create({
      data: {
        conversationId: opts.parentConversationId,
        role: 'tool',
        content: `[subagent:${sub.id}:complete] ${finalAnswer.slice(0, 500)}`,
        toolName: 'subagent_complete',
        toolArgs: JSON.stringify({ agentId: sub.id, dispatchId: opts.dispatchId, task: opts.task }),
        toolResult: finalAnswer,
      },
    })
  } catch {
    /* ignore */
  }

  return { answer: finalAnswer, steps }
}

/* For client-side reference: the full list with safe serializable fields */
export function serializeSubagents() {
  return SUBAGENTS.map((s) => ({
    id: s.id,
    name: s.name,
    role: s.role,
    specialty: s.specialty,
    color: s.color,
    icon: s.icon,
    allowedTools: s.allowedTools,
  }))
}

export { ALL_TOOLS as ALL_TOOL_NAMES }
