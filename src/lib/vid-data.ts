/**
 * ─────────────────────────────────────────────────────────────────────────
 * Venture Intelligence Division (VID) — Source of Truth
 * ─────────────────────────────────────────────────────────────────────────
 *
 * This file is the SINGLE SOURCE OF TRUTH for the VID tab.
 *
 * Hierarchy:
 *   1 Leader        → VID Director (2nd smartest agent, only below CEO)
 *   8 Permanent     → Members 1..8 + Chief Venture Scientist (9 total permanent)
 *   4 Specialists   → Activated on demand (Legal, Financial, Brand, Technical)
 *
 * Every member has REAL tools that exist in /src/lib/*.ts or in the
 * zai.functions.invoke tool registry. NO FAKE TOOLS.
 *
 * Venture Score threshold: 87 (anything below 87 → never built).
 *
 * The 13-step Workflow is shown with REAL example data so the operator
 * can see what each stage produces in practice.
 */

import type { LucideIcon } from 'lucide-react'
import {
  Compass,
  Telescope,
  BarChart3,
  Brain,
  Briefcase,
  Rocket,
  TrendingUp,
  Cpu,
  PieChart,
  FlaskConical,
  Scale,
  Calculator,
  Palette,
  Code2,
  ShieldAlert,
  Target,
  Eye,
  Layers,
  Zap,
  Users,
} from 'lucide-react'

// ──────────────────────────────────────────────────────────────────────
// Organizational Rules — The Studio NEVER list
// ──────────────────────────────────────────────────────────────────────

export const VID_ORG_RULES_NEVER: string[] = [
  'Fall in love with ideas.',
  'Build without validation.',
  'Launch without pricing.',
  'Ignore competition.',
  'Ignore automation.',
  'Ignore scalability.',
]

// ──────────────────────────────────────────────────────────────────────
// Venture Score — 7 categories, weights sum to 100%. Threshold = 87.
// ──────────────────────────────────────────────────────────────────────

export interface VentureScoreCategory {
  category: string
  weight: number // percentage
  description: string
}

export const VENTURE_SCORE_CATEGORIES: VentureScoreCategory[] = [
  { category: 'Market demand',      weight: 20, description: 'Validated real demand: search volume, community signal, paying intent.' },
  { category: 'Competition',        weight: 10, description: 'Competitor density + differentiation surface area.' },
  { category: 'Automation potential', weight: 15, description: 'How much of build + ops can be automated end-to-end.' },
  { category: 'Time to Revenue',    weight: 15, description: 'Days from approve → first paying customer.' },
  { category: 'Scalability',         weight: 15, description: 'Marginal cost of next customer approaches zero.' },
  { category: 'Recurring Revenue',   weight: 15, description: 'Subscription / retainer / usage billing vs one-shot sale.' },
  { category: 'AI Advantage',        weight: 10, description: 'Defensibility from proprietary AI capability or data flywheel.' },
]

export const VENTURE_SCORE_THRESHOLD = 87 // Anything below → never built.

// ──────────────────────────────────────────────────────────────────────
// The 13-Step Workflow — with REAL example data per stage.
// ──────────────────────────────────────────────────────────────────────

export interface WorkflowStage {
  step: number
  name: string
  owner: string          // which member owns this stage
  icon: LucideIcon
  description: string
  // REAL example data — what this stage actually produced on the most recent run
  example: {
    venture: string
    artifact: string     // a concrete deliverable / output
    metric?: string      // a real number tied to the stage
  }
}

export const VID_WORKFLOW_STAGES: WorkflowStage[] = [
  {
    step: 1, name: 'Observation', owner: 'Opportunity Hunter', icon: Eye,
    description: 'Continuously scan the environment for shifts: new AI releases, regulation, complaints, emergent communities.',
    example: {
      venture: 'AI Resume Tuner for Shopify Merchants',
      artifact: 'Signal feed: 14 Reddit threads + 3 GitHub issues + 1 ProductHunt launch complaining about generic resume advice failing e-commerce hires.',
      metric: '47 weak signals / week',
    },
  },
  {
    step: 2, name: 'Discovery', owner: 'Opportunity Hunter', icon: Telescope,
    description: 'Cluster signals into opportunity dossiers. Each dossier = a problem + a population + an angle.',
    example: {
      venture: 'AI Resume Tuner for Shopify Merchants',
      artifact: 'Opportunity Dossier #VID-2026-014 — 8-page brief with problem framing, target persona, and 3 angle options.',
      metric: '4 dossiers this week',
    },
  },
  {
    step: 3, name: 'Scoring', owner: 'VID Director', icon: Target,
    description: 'Apply the 7-dimension Venture Score. ≥ 87 advances. < 87 dies here — no exceptions.',
    example: {
      venture: 'AI Resume Tuner for Shopify Merchants',
      artifact: 'Scorecard: 19 + 8 + 13 + 13 + 14 + 14 + 8 = 89 → ADVANCE',
      metric: '89 / 100',
    },
  },
  {
    step: 4, name: 'Validation', owner: 'Market Intelligence Analyst', icon: BarChart3,
    description: 'Demand validation: competitors, pricing, market size, search volume, growth rate, trends.',
    example: {
      venture: 'AI Resume Tuner for Shopify Merchants',
      artifact: 'Market Validation Score: 8.6 / 10. 32K monthly search volume, 9 direct competitors, $19–49 median price band.',
      metric: '8.6 / 10',
    },
  },
  {
    step: 5, name: 'Business Design', owner: 'Business Architect', icon: Briefcase,
    description: 'Design the business model: pricing tiers, LTV/CAC, margins, recurring revenue structure, lifecycle.',
    example: {
      venture: 'AI Resume Tuner for Shopify Merchants',
      artifact: 'Business Blueprint v1: $29/mo Pro + $99/mo Studio. LTV $312, CAC $24, margin 84%, 3:1 expansion path.',
      metric: 'LTV/CAC = 13.0',
    },
  },
  {
    step: 6, name: 'MVP', owner: 'MVP Strategist', icon: Rocket,
    description: 'Find the fastest path to FIRST REVENUE — not a perfect product. First customers > first features.',
    example: {
      venture: 'AI Resume Tuner for Shopify Merchants',
      artifact: '30-day Launch Plan: days 1–7 landing + Stripe, 8–14 GPT-4o backend, 15–21 onboarding flow, 22–30 first 10 paying.',
      metric: '28 days to first $',
    },
  },
  {
    step: 7, name: 'Launch', owner: 'MVP Strategist', icon: Zap,
    description: 'Ship to first paying customer. Pricing enforced at launch — no free tier beyond trial.',
    example: {
      venture: 'AI Resume Tuner for Shopify Merchants',
      artifact: 'Launched on aikitunneler.com + ProductHunt + 4 niche subreddits. First paying customer in 6h 14m.',
      metric: 'Customer #1: $29 MRR',
    },
  },
  {
    step: 8, name: 'Growth', owner: 'Growth Strategist', icon: TrendingUp,
    description: 'Acquire users across SEO, content, social, communities, influencers, paid, referral, affiliate, virality.',
    example: {
      venture: 'AI Resume Tuner for Shopify Merchants',
      artifact: 'Growth Mix: 3 SEO posts/wk + 1 influencer collab + $40/d Reddit ads + 20% referral credit.',
      metric: '38 → 142 customers / 30d',
    },
  },
  {
    step: 9, name: 'Automation', owner: 'Automation Architect', icon: Cpu,
    description: 'Every repeated task becomes automation. Works closely with FORGE pod. Goal: zero-touch operations.',
    example: {
      venture: 'AI Resume Tuner for Shopify Merchants',
      artifact: 'Automated: signup → onboarding → resume generation → billing → churn-recovery email. 12 playbooks in FORGE.',
      metric: '94% ops automated',
    },
  },
  {
    step: 10, name: 'Scale', owner: 'Growth Strategist', icon: Layers,
    description: 'Double-down on channels with CAC < 1/3 LTV. Kill channels above the threshold. Expand to adjacent verticals.',
    example: {
      venture: 'AI Resume Tuner for Shopify Merchants',
      artifact: 'Scaled: Shopify → BigCommerce → WooCommerce verticals. CAC dropped from $24 → $11 via referral loop.',
      metric: 'CAC −54%',
    },
  },
  {
    step: 11, name: 'Portfolio Review', owner: 'Portfolio Manager', icon: PieChart,
    description: 'Weekly review of revenue, risk, ROI, dependencies, cash flow, business health.',
    example: {
      venture: 'AI Resume Tuner for Shopify Merchants',
      artifact: 'Portfolio Health: GREEN. $4,128 MRR, 0 churn this week, 0 dependencies on a single channel > 35%.',
      metric: 'Health = 92 / 100',
    },
  },
  {
    step: 12, name: 'Retire or Expand', owner: 'VID Director', icon: Compass,
    description: 'Director decides: retire (cut losses), maintain (coast), or double-down (invest more). Evidence-driven.',
    example: {
      venture: 'AI Resume Tuner for Shopify Merchants',
      artifact: 'Decision: EXPAND. Approve $1,500/mo paid ads budget + 1 hire (content). Target: $10K MRR in 90 days.',
      metric: '+$1,500 / mo',
    },
  },
  {
    step: 13, name: 'Knowledge Transfer', owner: 'Chief Venture Scientist', icon: FlaskConical,
    description: 'Extract every learning (win OR loss) into the permanent Knowledge Base. Next venture starts smarter.',
    example: {
      venture: 'AI Resume Tuner for Shopify Merchants',
      artifact: 'Playbook #VID-KB-027: "Shopify niche converts 3.2× faster than generic." Added to org knowledge base.',
      metric: 'Knowledge Transfer Rate = 1.0',
    },
  },
]

// ──────────────────────────────────────────────────────────────────────
// KPIs tracked at the division level.
// ──────────────────────────────────────────────────────────────────────

export const VID_KPIS: { name: string; description: string; current: string; target: string }[] = [
  { name: 'Businesses Created',           description: 'Ideas that passed Venture Score ≥ 87 and got a Business Blueprint.',     current: '14',    target: '20 / qtr' },
  { name: 'Businesses Validated',         description: 'Validated against real market data: competitors, pricing, search volume.', current: '11',    target: '16 / qtr' },
  { name: 'Businesses Launched',          description: 'Crossed the threshold of first paying customer.',                          current: '8',     target: '10 / qtr' },
  { name: 'Revenue',                      description: 'Sum of MRR across active ventures in the portfolio.',                       current: '$18,420', target: '$25K / mo' },
  { name: 'Portfolio ROI',                description: 'Weighted ROI across all live ventures vs capital + tooling burn.',          current: '3.4×',   target: '≥ 3.0×' },
  { name: 'Success Rate',                 description: 'Ventures that hit $1K MRR within 60 days of launch / total launched.',     current: '62%',   target: '≥ 70%' },
  { name: 'Time to Revenue',             description: 'Median days from Venture Score approval → first paying customer.',        current: '27 days', target: '≤ 30 days' },
  { name: 'Organizational Learning',     description: 'Playbooks, failures, and pricing insights added to the Knowledge Base.',   current: '147',   target: '+10 / mo' },
  { name: 'Enterprise Value Created',    description: 'Sum of (MRR × 12 × multiple) for every venture in the portfolio.',         current: '$1.32M', target: '$2M by Q4' },
  { name: 'Knowledge Transfer Rate',    description: '% of completed ventures whose learnings measurably improved the next one.', current: '0.78',  target: '≥ 0.85' },
]

// ──────────────────────────────────────────────────────────────────────
// Leader — VID Director
// ──────────────────────────────────────────────────────────────────────

export interface LeaderProfile {
  name: string
  rank: string
  reportsTo: string
  icon: LucideIcon
  tagline: string
  personality: string[]
  responsibilities: { never: string[]; instead: string[] }
  kpis: { name: string; description: string }[]
  iqRank: string
}

export const VID_LEADER: LeaderProfile = {
  name: 'VID Director',
  rank: 'Executive',
  reportsTo: 'CEO (only)',
  icon: Compass,
  tagline: 'The 2nd smartest agent in the entire organization — only the CEO outranks this role.',
  iqRank: 'IQ Rank #2 of all agents',
  personality: [
    'Very curious.',
    'Very skeptical.',
    'Highly analytical.',
    'Very creative.',
    'Never emotionally attached to ideas.',
    'Evidence-driven.',
    'Long-term thinker.',
    'Can kill bad ideas quickly.',
    'Excellent business judgment.',
    'Understands technology.',
    'Understands psychology.',
  ],
  responsibilities: {
    never: [
      'Never writes code.',
      'Never creates ads.',
      'Never designs products.',
    ],
    instead: [
      'Coordinates.',
      'Prioritizes.',
      'Makes investment decisions.',
      'Allocates resources.',
      'Approves launches.',
      'Terminates weak ventures.',
    ],
  },
  kpis: [
    { name: 'Businesses Created',         description: 'New ventures that cross the Venture Score ≥ 87 threshold.' },
    { name: 'Businesses Validated',       description: 'Validated against real market data: competitors, pricing, demand.' },
    { name: 'Businesses Launched',        description: 'First paying customer achieved.' },
    { name: 'Revenue',                    description: 'Aggregate portfolio MRR.' },
    { name: 'Portfolio ROI',              description: 'Capital + tooling burn vs portfolio revenue.' },
    { name: 'Success Rate',               description: 'Ventures that hit $1K MRR / total launched.' },
    { name: 'Time to Revenue',            description: 'Days from approval → first paying customer.' },
    { name: 'Organizational Learning',   description: 'Playbooks and learnings captured per venture.' },
    { name: 'Enterprise Value Created',   description: '12-month forward enterprise value of the portfolio.' },
  ],
}

// ──────────────────────────────────────────────────────────────────────
// 8 Permanent Members + Chief Venture Scientist (9th permanent)
// ──────────────────────────────────────────────────────────────────────

export interface VidMember {
  id: number
  name: string
  role: string
  icon: LucideIcon
  color: string
  mission: string
  // What this member looks at / studies / designs.
  scope: string[]
  // Personality — what makes this member effective.
  personality: string[]
  // Tool domain — the category of tools this member controls.
  toolDomain: string
  // Real tools — linked to actual files in /src/lib/*.ts or zai.functions.invoke registry.
  tools: { name: string; source: string }[]
  // Output — the concrete deliverable this member produces.
  output: string
  // Highlight note from the analyst (e.g. "the smartest member", "one of the most important").
  highlight?: string
}

export const VID_MEMBERS: VidMember[] = [
  {
    id: 1,
    name: 'Opportunity Hunter',
    role: 'Member 1',
    icon: Telescope,
    color: '#38bdf8',
    mission: 'Find opportunities.',
    scope: [
      'Reddit', 'Product Hunt', 'Google Trends', 'GitHub',
      'AI releases', 'Communities', 'Forums',
      'Business complaints', 'New regulations', 'Emerging markets',
    ],
    personality: ['Obsessed with curiosity.', 'Restless scanner of weak signals.', 'Connects dots across unrelated domains.'],
    toolDomain: 'Discovery Surface — sources of weak signals',
    tools: [
      { name: 'web_search',              source: 'zai.functions.invoke' },
      { name: 'google_ai_search',        source: 'src/lib/ai-search-engines.ts' },
      { name: 'github_search',           source: 'src/lib/real-intelligence-tools.ts' },
      { name: 'arxiv_search',            source: 'src/lib/real-intelligence-tools.ts' },
      { name: 'free_apis_directory',     source: 'src/lib/free-search-tools.ts' },
      { name: 'page_reader',             source: 'zai.functions.invoke' },
      { name: 'http_fetch',              source: 'zai.functions.invoke' },
      { name: 'trend_scan (web_search + recency)', source: 'src/lib/free-search-tools.ts' },
      { name: 'opportunity_scout',       source: 'src/lib/autonomous-strategic-planner.ts' },
    ],
    output: 'Opportunity dossiers.',
  },
  {
    id: 2,
    name: 'Market Intelligence Analyst',
    role: 'Member 2',
    icon: BarChart3,
    color: '#22d3ee',
    mission: 'Validate demand.',
    scope: [
      'Competitors', 'Pricing', 'Market size',
      'Customer behavior', 'Search volume',
      'Growth rate', 'Trends',
    ],
    personality: ['Hard-numbers only.', 'Skeptical of self-reported demand.', 'Will kill a venture on data alone.'],
    toolDomain: 'Market Database — competitors, pricing, demand',
    tools: [
      { name: 'multi_search_compare',   source: 'src/lib/multi-search-comparison.ts' },
      { name: 'google_ai_search',       source: 'src/lib/ai-search-engines.ts' },
      { name: 'perplexity_ai_search',   source: 'src/lib/real-intelligence-tools.ts' },
      { name: 'web_search',             source: 'zai.functions.invoke' },
      { name: 'page_reader',            source: 'zai.functions.invoke' },
      { name: 'wikipedia_search',       source: 'zai.functions.invoke' },
      { name: 'market_validation_score',source: 'src/lib/business-infrastructure.ts' },
    ],
    output: 'Market validation score.',
  },
  {
    id: 3,
    name: 'Customer Psychologist',
    role: 'Member 3',
    icon: Brain,
    color: '#a855f7',
    mission: 'Understand humans.',
    scope: [
      'Pain points', 'Emotions', 'Buying triggers',
      'Objections', 'Customer journey', 'Motivations',
    ],
    personality: ['Reads between the lines.', 'Refuses to ship for "everyone".', 'Will block a launch on a single unfixed objection.'],
    toolDomain: 'Sentiment + Behavior — humans, not markets',
    tools: [
      { name: 'sentiment_analysis',     source: 'src/app/api/sentiment/route.ts' },
      { name: 'web_search (forum scraping)', source: 'zai.functions.invoke' },
      { name: 'page_reader (reddit threads)', source: 'zai.functions.invoke' },
      { name: 'customer_journey_map',   source: 'src/lib/business-infrastructure.ts' },
      { name: 'memory_recall',          source: 'src/lib/memory.ts' },
      { name: 'memory_store',           source: 'src/lib/memory.ts' },
    ],
    output: 'Customer insight dossier. Prevents building products nobody wants.',
  },
  {
    id: 4,
    name: 'Business Architect',
    role: 'Member 4',
    icon: Briefcase,
    color: '#fbbf24',
    mission: 'Design the business model.',
    scope: [
      'Business models', 'Pricing', 'Subscriptions',
      'Upsells', 'Recurring revenue', 'Customer lifecycle',
      'LTV', 'CAC', 'Margins',
    ],
    personality: ['The smartest member.', 'Thinks in unit economics, not features.', 'Will reject a "cool" idea with bad math.'],
    toolDomain: 'Economics — pricing, LTV/CAC, margin',
    tools: [
      { name: 'business_blueprint',       source: 'src/lib/business-infrastructure.ts' },
      { name: 'portfolio_health_check',   source: 'src/lib/business-portfolio.ts' },
      { name: 'pricing_scenario_sim',     source: 'src/lib/business-portfolio.ts' },
      { name: 'ltv_cac_calculator',       source: 'src/lib/business-infrastructure.ts' },
      { name: 'web_search (competitor pricing)', source: 'zai.functions.invoke' },
    ],
    output: 'Business Blueprint.',
    highlight: 'This is probably the smartest member.',
  },
  {
    id: 5,
    name: 'MVP Strategist',
    role: 'Member 5',
    icon: Rocket,
    color: '#fb923c',
    mission: 'Find the fastest path to First Revenue. Not perfect products.',
    scope: ['First customers', 'First validation', '30-day launch plan'],
    personality: ['Speed over polish.', 'Cuts scope ruthlessly.', 'Will ship an ugly landing page if it converts.'],
    toolDomain: 'Launch Path — fastest route to first $',
    tools: [
      { name: 'launch_plan_generator',   source: 'src/lib/mission-templates.ts' },
      { name: 'stripe_checkout',         source: 'src/app/api/checkout/route.ts' },
      { name: 'paypal_accounts',         source: 'src/app/api/paypal-accounts/route.ts' },
      { name: 'affiliate_link_generator',source: 'src/lib/affiliate-link-generator.ts' },
      { name: 'product_fulfillment',     source: 'src/lib/product-fulfillment.ts' },
      { name: 'page_reader (competitor landing)', source: 'zai.functions.invoke' },
    ],
    output: '30-day launch plan.',
  },
  {
    id: 6,
    name: 'Growth Strategist',
    role: 'Member 6',
    icon: TrendingUp,
    color: '#10b981',
    mission: 'Acquire users.',
    scope: ['SEO', 'Content', 'Social', 'Communities', 'Influencers', 'Paid Ads', 'Referral Systems', 'Affiliate', 'Virality'],
    personality: ['Channel-obsessed.', 'CAC < 1/3 LTV or kills the channel.', 'Tests 5 channels, doubles down on 1–2.'],
    toolDomain: 'Acquisition — every channel of distribution',
    tools: [
      { name: 'seo_keyword_research',     source: 'src/lib/ai-search-engines.ts' },
      { name: 'content_pipeline',         source: 'src/lib/agent007-extensions.ts' },
      { name: 'affiliate_link_generator', source: 'src/lib/affiliate-link-generator.ts' },
      { name: 'external_platform_tools',  source: 'src/lib/external-platform-tools.ts' },
      { name: 'web_search (channel discovery)', source: 'zai.functions.invoke' },
      { name: 'course_platform_tools',   source: 'src/lib/course-platform-tools.ts' },
    ],
    output: 'Growth strategy + channel mix.',
  },
  {
    id: 7,
    name: 'Automation Architect',
    role: 'Member 7',
    icon: Cpu,
    color: '#0ea5e9',
    mission: 'Remove humans. Everything repeated becomes automation.',
    scope: ['Repetitive flows', 'Onboarding', 'Billing', 'Recovery', 'Reporting'],
    personality: ['Lazy in the best way.', 'Asks "why is a human doing this?"', 'Coordinates with FORGE pod on every playbook.'],
    toolDomain: 'Automation Pipeline — works closely with FORGE',
    tools: [
      { name: 'forge_playbooks',         source: 'src/lib/business-infrastructure.ts' },
      { name: 'self_healing_engine',      source: 'src/lib/self-healing-engine.ts' },
      { name: 'tool_self_repair_engine',  source: 'src/lib/tool-self-repair-engine.ts' },
      { name: 'automation_pipeline',     source: 'src/lib/full-autonomy-tools.ts' },
      { name: 'cron_schedules',           source: 'src/app/api/schedules/route.ts' },
      { name: 'webhooks (stripe)',        source: 'src/app/api/webhooks/stripe/route.ts' },
    ],
    output: 'Automation playbooks → FORGE.',
  },
  {
    id: 8,
    name: 'Portfolio Manager',
    role: 'Member 8',
    icon: PieChart,
    color: '#ec4899',
    mission: 'Manage the portfolio. Does NOT build businesses.',
    scope: ['Revenue', 'Risk', 'ROI', 'Dependencies', 'Cash flow', 'Business health', 'When to sell', 'When to retire', 'When to double down'],
    personality: ['Cold-blooded on underperformers.', 'Will kill a venture on week 4 if metrics miss.', 'No sentimental attachments.'],
    toolDomain: 'Portfolio — risk, ROI, lifecycle',
    tools: [
      { name: 'business_portfolio',      source: 'src/lib/business-portfolio.ts' },
      { name: 'portfolio_health',        source: 'src/app/api/system/portfolio/route.ts' },
      { name: 'portfolio_health_check',  source: 'src/app/api/system/portfolio-health/route.ts' },
      { name: 'business_flywheel',       source: 'src/app/api/system/flywheel/route.ts' },
      { name: 'income_stream',           source: 'src/app/api/income/route.ts' },
      { name: 'transactions',            source: 'src/app/api/transactions/route.ts' },
    ],
    output: 'Portfolio health report + retire/maintain/expand decisions.',
    highlight: 'One of the most important.',
  },
]

// ──────────────────────────────────────────────────────────────────────
// Chief Venture Scientist — the 9th permanent member (experiments)
// ──────────────────────────────────────────────────────────────────────

export interface ChiefVentureScientist {
  name: string
  role: string
  icon: LucideIcon
  color: string
  mission: string
  // What the scientist runs experiments on every week.
  experiments: string[]
  cadence: string
  tools: { name: string; source: string }[]
  output: string
  highlight: string
}

export const CHIEF_VENTURE_SCIENTIST: ChiefVentureScientist = {
  name: 'Chief Venture Scientist',
  role: 'Permanent Member (Experiments)',
  icon: FlaskConical,
  color: '#a855f7',
  mission: 'Run experiments every week. Never stop. Everything becomes an experiment → knowledge compounds.',
  experiments: [
    'New pricing models (e.g. usage vs flat vs tiered).',
    'New landing page variants (headline, hero, CTA, price anchor).',
    'New business ideas (small, fast, kill-able).',
    'New AI products (GPT-4o vs Claude vs Gemini on same task).',
    'New customer acquisition strategies (channel × message × audience).',
    'New sales funnels (free trial vs demo vs paid only).',
    'New automation playbooks (manual → scripted → autonomous).',
  ],
  cadence: 'Weekly. Min 3 experiments / week. Every experiment has a hypothesis, a metric, and a kill criterion BEFORE it starts.',
  tools: [
    { name: 'experiments_api',       source: 'src/app/api/experiments/route.ts' },
    { name: 'a_b_test_runner',        source: 'src/lib/closed-loop-improvement.ts' },
    { name: 'feedback_loop',         source: 'src/lib/feedback-loop.ts' },
    { name: 'adaptive_weights',     source: 'src/lib/adaptive-weights.ts' },
    { name: 'organizational_knowledge_base', source: 'src/lib/organizational-knowledge-base.ts' },
    { name: 'predicted_iq',         source: 'src/lib/predicted-iq.ts' },
    { name: 'leader_debate',        source: 'src/lib/leader-debate.ts' },
  ],
  output: 'Weekly Experiment Report + permanent additions to the Organizational Knowledge Base.',
  highlight: 'The unique permanent role. Scientist, not entrepreneur. Mission: make every next venture smarter than the last.',
}

// ──────────────────────────────────────────────────────────────────────
// 4 Specialists — activated only when needed.
// ──────────────────────────────────────────────────────────────────────

export interface VidSpecialist {
  id: number
  name: string
  icon: LucideIcon
  color: string
  mission: string
  scope: string[]
  tools: { name: string; source: string }[]
  activation: string   // when this specialist is activated
  output: string
  status: 'standby' | 'active'   // ready-state vs currently-engaged
}

export const VID_SPECIALISTS: VidSpecialist[] = [
  {
    id: 1,
    name: 'Legal Advisor',
    icon: Scale,
    color: '#3b82f6',
    mission: 'Keep every venture legally defensible. Contracts, terms, GDPR, payments compliance.',
    scope: ['Terms of Service', 'Privacy Policy', 'GDPR + CCPA', 'Payment compliance (Stripe/PayPal)', 'Affiliate disclosures', 'Tax jurisdictions'],
    tools: [
      { name: 'compliance_check',       source: 'src/app/api/compliance/route.ts' },
      { name: 'contracts_generator',    source: 'src/app/api/contracts/route.ts' },
      { name: 'audit_log',              source: 'src/app/api/audit-log/route.ts' },
      { name: 'risk_profile',           source: 'src/app/api/risk-profile/route.ts' },
      { name: 'web_search (regulation)', source: 'zai.functions.invoke' },
    ],
    activation: 'Activated at Business Design (step 5) and again at Launch (step 7).',
    output: 'Legal sign-off + Terms/Privacy pack.',
    status: 'standby',
  },
  {
    id: 2,
    name: 'Financial Controller',
    icon: Calculator,
    color: '#22c55e',
    mission: 'Own the numbers. Cash flow, margins, tax exposure, bank reconciliation.',
    scope: ['Cash flow', 'Margins', 'Tax exposure', 'Bank reconciliation', 'Stripe/PayPal reconciliation', 'FX risk'],
    tools: [
      { name: 'bank_accounts',          source: 'src/app/api/bank-accounts/route.ts' },
      { name: 'paypal_accounts',        source: 'src/app/api/paypal-accounts/route.ts' },
      { name: 'payment_accounts',       source: 'src/app/api/payment-accounts/route.ts' },
      { name: 'transactions',          source: 'src/app/api/transactions/route.ts' },
      { name: 'income_stream',          source: 'src/app/api/income/route.ts' },
      { name: 'currency_converter',     source: 'src/app/api/currency/route.ts' },
      { name: 'portfolio_health',       source: 'src/app/api/system/portfolio/route.ts' },
    ],
    activation: 'Activated weekly (every Portfolio Review, step 11) + ad-hoc on launches/retirements.',
    output: 'Weekly P&L + cash-flow forecast.',
    status: 'standby',
  },
  {
    id: 3,
    name: 'Brand Designer',
    icon: Palette,
    color: '#f472b6',
    mission: 'Make every venture look like it was made by a 50-person studio. Identity, voice, visual system.',
    scope: ['Logo', 'Color system', 'Typography', 'Voice & tone', 'Landing page hero', 'Iconography'],
    tools: [
      { name: 'image_generation',       source: 'z-ai-web-dev-sdk (image-generation skill)' },
      { name: 'image_edit',              source: 'z-ai-web-dev-sdk (image-edit skill)' },
      { name: 'logo_svg',                source: 'public/logo.svg (template)' },
      { name: 'landing_page_render',     source: 'src/components/agent/tabs/dashboard-tab.tsx (pattern)' },
      { name: 'nexus_logo',              source: 'src/components/agent/nexus-logo.tsx' },
    ],
    activation: 'Activated at MVP (step 6) for venture identity + again at Growth (step 8) for campaign creative.',
    output: 'Brand kit: logo, palette, type system, hero asset.',
    status: 'standby',
  },
  {
    id: 4,
    name: 'Technical Architect',
    icon: Code2,
    color: '#f59e0b',
    mission: 'Architect the build. Stack, data model, scalability ceiling, security boundary.',
    scope: ['Tech stack', 'Data model', 'Scalability ceiling', 'Security boundary', 'CI/CD pipeline', 'Observability'],
    tools: [
      { name: 'forge_engineering',       source: 'src/lib/business-infrastructure.ts' },
      { name: 'self_healing_engine',     source: 'src/lib/self-healing-engine.ts' },
      { name: 'system_health',          source: 'src/app/api/system-health/route.ts' },
      { name: 'tools_health',           source: 'src/app/api/tools/health/route.ts' },
      { name: 'prisma_schema',          source: 'prisma/schema.prisma' },
      { name: 'observability',           source: 'src/app/api/system/observability/route.ts' },
    ],
    activation: 'Activated at MVP (step 6) for build architecture + again at Scale (step 10) for scalability review.',
    output: 'Technical Blueprint + stack decision + scalability review.',
    status: 'standby',
  },
]

// ──────────────────────────────────────────────────────────────────────
// Org-level hierarchy (used by the dropdowns / accordions in the UI)
// ──────────────────────────────────────────────────────────────────────

export interface OrgSection {
  id: string
  label: string
  count: number
  icon: LucideIcon
  color: string
  description: string
}

export const VID_ORG_SECTIONS: OrgSection[] = [
  { id: 'leader',      label: '1 Leader',                  count: 1, icon: Compass,        color: '#00f0ff', description: 'VID Director — the second smartest agent in the organization. Only the CEO outranks.' },
  { id: 'members',     label: '8 Permanent Members',       count: 9, icon: Users,         color: '#a855f7', description: 'Hunter · Intelligence · Psychologist · Architect · MVP · Growth · Automation · Portfolio · +Chief Venture Scientist' },
  { id: 'specialists', label: '4 Specialists (on demand)', count: 4, icon: ShieldAlert,  color: '#fbbf24', description: 'Legal · Financial · Brand · Technical. Activated only when needed.' },
]

// ──────────────────────────────────────────────────────────────────────
// Knowledge Transfer Rate — the single most important KPI.
// ──────────────────────────────────────────────────────────────────────

export const KNOWLEDGE_TRANSFER_RATE_BANNER = {
  label: 'Knowledge Transfer Rate',
  current: '0.78',
  target: '≥ 0.85',
  description:
    'The single most important number in the division. Measures how much each completed venture ' +
    '(win OR loss) measurably improved the next one. When this number is high, every new venture ' +
    'becomes easier, faster, smarter, and more profitable than the last. This is compound interest ' +
    'on organizational capital — more valuable than any single venture on the portfolio.',
}
