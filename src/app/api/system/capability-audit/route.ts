import { NextResponse } from 'next/server'
import { TOOL_REGISTRY } from '@/lib/tools'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * GET /api/system/capability-audit
 *
 * UPGRADE #174: Real-time audit of which tools the agent can ACTUALLY
 * execute (have credentials) vs which exist in code but cannot run.
 *
 * WHY THIS EXISTS:
 *   The agent's prior responses recommended ConvertKit, Mailchimp,
 *   Hootsuite, Buffer, ShareASale, Google Analytics — but the user's
 *   Vercel project had ZERO credentials for any of them. The agent
 *   was recommending tools it couldn't actually use.
 *
 * WHAT IT RETURNS:
 *   - tools_with_credentials: tools where the required env vars are SET
 *     (and non-empty) on this Vercel instance
 *   - tools_without_credentials: tools that exist in TOOL_REGISTRY but
 *     whose required env vars are missing or empty
 *   - autonomy_percentage: % of revenue-critical tools that have credentials
 *   - blocking_for_revenue: which credentials are blocking $1 of real money
 *   - llm_providers: which LLM providers are configured (Groq, OpenAI, z.ai, Mistral)
 *   - marketing_channels: status of email/social/affiliate/payment/analytics
 *
 * USAGE:
 *   Antonio can curl this endpoint to see what's blocking real money.
 *   The agent itself can be taught to call this endpoint before recommending
 *   any external tool — so it stops recommending ConvertKit when
 *   CONVERTKIT_API_KEY is not set.
 *
 * AUTH: Public — same as /api/system/diagnose-llm. The data here is
 * already public (env vars SET/NOT_SET status is visible from the
 * diagnose-llm endpoint anyway).
 */

// UPGRADE #174: Map of tool name → required env vars.
// A tool is "with credentials" only if ALL its required env vars are
// SET (non-empty string). Empty strings count as missing.
const TOOL_REQUIRED_ENV: Record<string, string[]> = {
  // === PAYMENT (revenue-critical) ===
  stripe_payment_processor: ['STRIPE_SECRET_KEY'],
  stripe_create_payment: ['STRIPE_SECRET_KEY'],
  paypal_api: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'],
  paypal_rest_api: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'],

  // === EMAIL MARKETING ===
  convertkit_email: ['CONVERTKIT_API_KEY'],
  mailchimp_list_manager: ['MAILCHIMP_API_KEY'],
  email_marketing_automation: ['CONVERTKIT_API_KEY'],
  email_marketing_automation_full: ['CONVERTKIT_API_KEY'],
  email_marketing_setup: ['CONVERTKIT_API_KEY'],

  // === SOCIAL MEDIA SCHEDULERS ===
  buffer_scheduler: ['BUFFER_ACCESS_TOKEN'],
  hootsuite_schedule: ['HOOTSUITE_ACCESS_TOKEN'],

  // === AFFILIATE MARKETING ===
  // UPGRADE #175: AMAZON_PA_API_KEY is OPTIONAL — only needed for programmatic
  // product search (the agent can use web_search + page_reader instead).
  // AMAZON_ASSOCIATES_TAG ALONE is enough to monetize: agent builds links as
  // https://www.amazon.com/dp/{ASIN}?tag={tag} — no API call required.
  affiliate_link_generator: ['AMAZON_ASSOCIATES_TAG'],
  affiliate_tracker: [], // uses internal DB, no external API
  affiliate_funnel_builder: [], // design only, no external API

  // === CONTENT PUBLISHING ===
  wordpress_publisher: ['WORDPRESS_URL', 'WORDPRESS_USER', 'WORDPRESS_APP_PASSWORD'],

  // === ANALYTICS ===
  google_analytics: ['GOOGLE_ANALYTICS_API_KEY'],

  // === COMMUNICATION (notifications) ===
  telegram_notify: ['TELEGRAM_BOT_TOKEN'],
  ntfy_notify: [], // ntfy.sh works without auth
  discord_notify: ['DISCORD_WEBHOOK_URL'],

  // === SEARCH (free APIs) ===
  web_search: [], // uses multiple free providers
  accuracy_checker: [], // uses Wikipedia + DuckDuckGo (free) + Brave (optional)
  wikipedia_search: [],
  wikipedia_read: [],
  free_apis_directory: [],

  // === LLM TOOLS ===
  multi_provider_compare: ['GROQ_API_KEY'], // needs at least one LLM
}

// Categorize tools by mission-criticality for the $20K/mo goal
const REVENUE_CRITICAL_TOOLS = [
  'stripe_payment_processor',  // collect payments
  'paypal_api',                 // alt payment
  'convertkit_email',          // email capture + nurture
  'buffer_scheduler',          // social distribution
  'affiliate_link_generator',  // affiliate revenue
  'google_analytics',           // measurement
]

const MARKETING_CHANNELS = {
  email: ['convertkit_email', 'mailchimp_list_manager', 'email_marketing_automation'],
  social: ['buffer_scheduler', 'hootsuite_schedule'],
  affiliate: ['affiliate_link_generator', 'affiliate_tracker', 'affiliate_funnel_builder'],
  payment: ['stripe_payment_processor', 'paypal_api'],
  analytics: ['google_analytics'],
  publishing: ['wordpress_publisher'],
}

const LLM_PROVIDERS = [
  { name: 'Groq', env: 'GROQ_API_KEY', speed: 'fastest', cost: 'free' },
  { name: 'OpenAI', env: 'OPENAI_API_KEY', speed: 'medium', cost: 'paid' },
  { name: 'z.ai', env: 'ZAI_API_KEY', speed: 'medium', cost: 'free' },
  { name: 'Mistral', env: 'MISTRAL_API_KEY', speed: 'slow', cost: 'free tier' },
]

function isEnvSet(key: string): boolean {
  const v = process.env[key]
  return !!v && v.length > 0
}

export async function GET() {
  const auditStart = Date.now()

  // ── LLM PROVIDERS ────────────────────────────────────────────────
  const llmConfigured = LLM_PROVIDERS.map(p => ({
    name: p.name,
    configured: isEnvSet(p.env),
    envVar: p.env,
    speed: p.speed,
    cost: p.cost,
  }))

  // ── TOOLS AUDIT ─────────────────────────────────────────────────
  const allTools = Object.keys(TOOL_REGISTRY)
  const toolsWithCreds: Array<{ name: string; label: string }> = []
  const toolsWithoutCreds: Array<{ name: string; label: string; missingEnvVars: string[] }> = []
  const toolsNoExternalDeps: Array<{ name: string; label: string }> = []

  for (const toolName of allTools) {
    const required = TOOL_REQUIRED_ENV[toolName]
    const label = TOOL_REGISTRY[toolName]?.label ?? toolName

    if (!required) {
      // Tool not in our map — most tools have no external API dependency.
      // They use internal DB, LLM, or free APIs.
      toolsNoExternalDeps.push({ name: toolName, label })
      continue
    }

    if (required.length === 0) {
      // Listed but explicitly no external deps (e.g., affiliate_tracker uses DB only)
      toolsNoExternalDeps.push({ name: toolName, label })
      continue
    }

    const missing = required.filter(v => !isEnvSet(v))
    if (missing.length === 0) {
      toolsWithCreds.push({ name: toolName, label })
    } else {
      toolsWithoutCreds.push({ name: toolName, label, missingEnvVars: missing })
    }
  }

  // ── REVENUE-CRITICAL COVERAGE ──────────────────────────────────
  const revenueCriticalStatus = REVENUE_CRITICAL_TOOLS.map(toolName => {
    const required = TOOL_REQUIRED_ENV[toolName] ?? []
    const missing = required.filter(v => !isEnvSet(v))
    return {
      tool: toolName,
      label: TOOL_REGISTRY[toolName]?.label ?? toolName,
      ready: missing.length === 0,
      missingEnvVars: missing,
    }
  })
  const revenueCriticalReady = revenueCriticalStatus.filter(t => t.ready).length
  const revenueCriticalTotal = REVENUE_CRITICAL_TOOLS.length
  const autonomyPercentage = Math.round((revenueCriticalReady / revenueCriticalTotal) * 100)

  // ── MARKETING CHANNEL STATUS ───────────────────────────────────
  const channelStatus = Object.entries(MARKETING_CHANNELS).map(([channel, tools]) => {
    const ready = tools.some(t => {
      const required = TOOL_REQUIRED_ENV[t] ?? []
      return required.length === 0 || required.every(v => isEnvSet(v))
    })
    const readyTools = tools.filter(t => {
      const required = TOOL_REQUIRED_ENV[t] ?? []
      return required.length === 0 || required.every(v => isEnvSet(v))
    })
    return {
      channel,
      ready,
      readyTools,
      allTools: tools,
      blockingEnvVars: Array.from(new Set(
        tools.flatMap(t => TOOL_REQUIRED_ENV[t] ?? []).filter(v => !isEnvSet(v))
      )),
    }
  })

  // ── WHAT'S BLOCKING REAL MONEY ──────────────────────────────────
  const blockingForRevenue: Array<{ envVar: string; tools: string[]; setupTime: string; cost: string }> = []

  if (!isEnvSet('STRIPE_SECRET_KEY')) {
    blockingForRevenue.push({
      envVar: 'STRIPE_SECRET_KEY',
      tools: ['stripe_payment_processor', 'stripe_create_payment'],
      setupTime: '~30 min (signup + add key)',
      cost: 'Free signup, 2.9% + $0.30 per transaction',
    })
  }
  if (!isEnvSet('CONVERTKIT_API_KEY')) {
    blockingForRevenue.push({
      envVar: 'CONVERTKIT_API_KEY',
      tools: ['convertkit_email', 'email_marketing_automation'],
      setupTime: '~30 min (signup + add key)',
      cost: 'Free for first 1,000 subscribers',
    })
  }
  if (!isEnvSet('BUFFER_ACCESS_TOKEN')) {
    blockingForRevenue.push({
      envVar: 'BUFFER_ACCESS_TOKEN',
      tools: ['buffer_scheduler'],
      setupTime: '~30 min (signup + connect 3 social accounts)',
      cost: 'Free for 3 social accounts',
    })
  }
  if (!isEnvSet('AMAZON_ASSOCIATES_TAG')) {
    blockingForRevenue.push({
      envVar: 'AMAZON_ASSOCIATES_TAG (Amazon Associate Tag only — PA API optional)',
      tools: ['affiliate_link_generator'],
      // UPGRADE #175: Just the Associates Tag unlocks affiliate links.
      // Build: https://www.amazon.com/dp/{ASIN}?tag={your-tag-20}
      // Antonio already has an Associates account. Just needs to add
      // the tag env var. No PA API wait required.
      setupTime: '~5 min (you already have an Associates account, just add the tag env var)',
      cost: 'Free, 1-10% commission on Amazon sales',
    })
  }
  // Add ClickBank as alternative (instant signup, no API wait)
  if (!isEnvSet('CLICKBANK_API_KEY')) {
    blockingForRevenue.push({
      envVar: 'CLICKBANK_API_KEY (alternative — INSTANT signup, no approval)',
      tools: ['affiliate_link_generator'],
      setupTime: '~10 min (signup + verify email + add payment info)',
      cost: 'Free, 50-75% commission on digital products',
    })
  }
  // Add PartnerStack as alternative (SaaS-focused, fast approval)
  if (!isEnvSet('PARTNERSTACK_API_KEY')) {
    blockingForRevenue.push({
      envVar: 'PARTNERSTACK_API_KEY (alternative for SaaS — 1-2 day approval)',
      tools: ['affiliate_link_generator'],
      setupTime: '~1-2 days (apply + per-brand approval)',
      cost: 'Free, 20-30% LIFETIME RECURRING on SaaS products',
    })
  }
  if (!isEnvSet('GOOGLE_ANALYTICS_API_KEY')) {
    blockingForRevenue.push({
      envVar: 'GOOGLE_ANALYTICS_API_KEY (optional — GA tag is enough)',
      tools: ['google_analytics'],
      setupTime: '~30 min (install GA tag, optional API key)',
      cost: 'Free',
    })
  }

  // ── FINAL VERDICT ───────────────────────────────────────────────
  let verdict = ''
  let canEarnRealMoney = false
  if (revenueCriticalReady === revenueCriticalTotal) {
    verdict = 'FULLY AUTONOMOUS: All revenue-critical credentials configured. Agent can complete missions end-to-end.'
    canEarnRealMoney = true
  } else if (isEnvSet('STRIPE_SECRET_KEY') && (isEnvSet('CONVERTKIT_API_KEY') || isEnvSet('BUFFER_ACCESS_TOKEN'))) {
    verdict = 'PARTIAL: Can collect payments + send to at least one channel. Real money possible with manual content shipping.'
    canEarnRealMoney = true
  } else if (isEnvSet('STRIPE_SECRET_KEY')) {
    verdict = 'PAYMENT-READY: Can collect payments but cannot capture emails or distribute content. Need ConvertKit + Buffer for full loop.'
    canEarnRealMoney = true
  } else {
    verdict = 'NOT READY: Cannot collect any payments. Agent can produce content but cannot SHIP it. Add STRIPE_SECRET_KEY first — that single key is the biggest unlock.'
    canEarnRealMoney = false
  }

  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    elapsed_ms: Date.now() - auditStart,

    // ── AUTONOMY SCORE ──────────────────────────────────────────
    autonomy_score: {
      percentage: autonomyPercentage,
      revenue_critical_ready: `${revenueCriticalReady}/${revenueCriticalTotal}`,
      can_earn_real_money_today: canEarnRealMoney,
      verdict,
    },

    // ── LLM PROVIDERS ───────────────────────────────────────────
    llm_providers: {
      configured: llmConfigured.filter(p => p.configured).map(p => p.name),
      missing: llmConfigured.filter(p => !p.configured).map(p => ({ name: p.name, envVar: p.envVar, cost: p.cost })),
      chain_order: ['Groq', 'OpenAI', 'z.ai', 'Mistral'].filter(n => llmConfigured.find(p => p.name === n)?.configured),
    },

    // ── TOOLS BREAKDOWN ─────────────────────────────────────────
    tools: {
      total_in_registry: allTools.length,
      with_credentials: toolsWithCreds.length,
      without_credentials: toolsWithoutCreds.length,
      no_external_deps: toolsNoExternalDeps.length,
    },

    // ── TOOLS THAT CAN RUN TODAY (have credentials) ────────────
    tools_with_credentials: toolsWithCreds.sort((a, b) => a.name.localeCompare(b.name)),

    // ── TOOLS THAT EXIST IN CODE BUT CAN'T RUN (missing env vars) ─
    tools_without_credentials: toolsWithoutCreds.sort((a, b) => a.name.localeCompare(b.name)),

    // ── REVENUE-CRITICAL TOOL STATUS ────────────────────────────
    revenue_critical_tools: revenueCriticalStatus,

    // ── MARKETING CHANNEL STATUS ────────────────────────────────
    marketing_channels: channelStatus,

    // ── WHAT'S BLOCKING $1 OF REAL MONEY ────────────────────────
    blocking_for_revenue: blockingForRevenue,

    // ── NEXT STEPS (recommended order) ─────────────────────────
    recommended_setup_order: [
      ...blockingForRevenue.map(b => ({
        step: `Add ${b.envVar}`,
        unlocks: b.tools,
        time: b.setupTime,
        cost: b.cost,
        priority: b.envVar.includes('STRIPE') ? 'CRITICAL (single biggest unlock)' : 'HIGH',
      })),
    ],
  })
}
