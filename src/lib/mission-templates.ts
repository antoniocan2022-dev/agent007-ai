/**
 * Mission Templates — pre-built multi-agent workflows that the user can launch
 * with a single click. Each template defines a sequence of sub-agent dispatches
 * with specific tasks, designed to accomplish a high-value goal end-to-end.
 *
 * Templates are static (not user-editable) but serve as starting points.
 * The user can customize the generated conversation after launch.
 */

export interface MissionTemplate {
  id: string
  name: string
  tagline: string
  description: string
  icon: string // lucide icon name
  color: string // hex accent
  estimatedMinutes: number
  agentsUsed: string[] // agent ids/names
  prompt: string // the full prompt sent to Agent007
}

export const MISSION_TEMPLATES: MissionTemplate[] = [
  {
    id: 'launch-saas-30',
    name: 'Launch SaaS in 30 Days',
    tagline: 'Scout → Vertex → Forge → Pulse → Echo',
    description:
      'End-to-end plan to launch a micro-SaaS: Scout finds trending niches, Vertex designs the product + pricing, Forge builds the MVP prototype, Pulse defines KPIs, Echo sets up A/B tests for launch.',
    icon: 'Rocket',
    color: '#00f0ff',
    estimatedMinutes: 8,
    agentsUsed: ['scout', 'vertex', 'forge', 'pulse', 'echo'],
    prompt:
      'MISSION: Launch a micro-SaaS in 30 days. Execute these 5 sub-agent dispatches in sequence:\n\n1. Dispatch Scout: "Find 3 trending micro-SaaS niches with high demand and low competition in 2025. Cite real URLs with search volume data."\n2. After Scout returns, dispatch Vertex: "Based on Scout\'s research, design a micro-SaaS blueprint for the best niche. Include: core features, pricing tiers (Free/Pro/Team), tech stack, 30-day MVP roadmap, and revenue projections."\n3. After Vertex returns, dispatch Forge: "Based on Vertex\'s blueprint, write the MVP prototype code for the core feature. Use code_exec to verify it works. Provide a GitHub-ready starter repo structure."\n4. After Forge returns, dispatch Pulse: "Define 5 KPIs for this SaaS launch (acquisition, activation, retention, revenue, referral). For each: formula, target, alert threshold, monitoring cadence. Use a markdown table."\n5. After Pulse returns, dispatch Echo: "Design 3 A/B tests for the launch week: landing page headline, pricing display, and onboarding flow. For each: hypothesis, control, variant, success metric, min sample size."\n\nAfter all 5 return, synthesize a final 30-day launch plan with daily milestones, income projections, and risk mitigation. Format as a structured report.',
  },
  {
    id: 'passive-income-funnel',
    name: 'Passive Income Funnel',
    tagline: 'Scout → Aurora → Quill → Prism → Pulse',
    description:
      'Build a complete content monetization funnel: Scout finds the niche, Aurora designs the content strategy, Quill writes the first 3 pieces, Prism creates brand visuals, Pulse sets up income tracking.',
    icon: 'TrendingUp',
    color: '#34d399',
    estimatedMinutes: 7,
    agentsUsed: ['scout', 'aurora', 'quill', 'prism', 'pulse'],
    prompt:
      'MISSION: Build a passive income content funnel. Execute these 5 dispatches in sequence:\n\n1. Dispatch Scout: "Find 3 high-CPM niches with growing search volume and low competition. Focus on evergreen topics that monetize well via affiliate + ads. Cite real data."\n2. After Scout returns, dispatch Aurora: "Based on Scout\'s research, design a 30-day content monetization plan for the best niche. Include: platform (blog/YouTube/newsletter), content pillars, affiliate programs, CPM estimates, and 30-day revenue projection."\n3. After Aurora returns, dispatch Quill: "Write the first 3 pieces of content based on Aurora\'s plan. Include: headlines, hooks, full body, CTAs, and SEO meta descriptions."\n4. After Quill returns, dispatch Prism: "Generate a brand logo + 1 hero banner for this content funnel. Use the niche and content style to inform the visual identity."\n5. After Pulse returns [wait for prior], dispatch Pulse: "Define 4 KPIs for this content funnel: traffic, CTR, conversion rate, RPM. Set 30-day targets and weekly milestones."\n\nSynthesize a final funnel blueprint with day-by-day action plan and income projection.',
  },
  {
    id: 'freelance-income-boost',
    name: 'Freelance Income Boost',
    tagline: 'Hunt → Quill → Prism → Pulse',
    description:
      'Land higher-paying freelance gigs: Hunt finds top-paying categories, Quill writes your pitch scripts, Prism designs your portfolio, Pulse tracks your pipeline KPIs.',
    icon: 'Briefcase',
    color: '#fbbf24',
    estimatedMinutes: 5,
    agentsUsed: ['hunt', 'quill', 'prism', 'pulse'],
    prompt:
      'MISSION: Boost freelance income. Execute these 4 dispatches:\n\n1. Dispatch Hunt: "Find the top 5 highest-paying freelance categories on Upwork and Fiverr right now. For each: typical hourly rate, demand level, platform fees, and 3 concrete gig packages (Starter/Standard/Premium). Cite real platform data."\n2. After Hunt returns, dispatch Quill: "Write 3 cold-pitch scripts for the top 3 freelance categories Hunt found. Each script: hook, value prop, social proof placeholder, CTA. Tailor for Upwork proposals + cold emails."\n3. After Quill returns, dispatch Prism: "Generate a minimalist portfolio logo + 1 service-offer graphic for the top freelance category. Professional, trustworthy aesthetic."\n4. After Prism returns, dispatch Pulse: "Define a freelance pipeline dashboard: 5 KPIs (pitches sent, response rate, proposals won, avg project value, monthly recurring). Set 90-day targets."\n\nSynthesize a 90-day freelance income growth plan with weekly milestones.',
  },
  {
    id: 'investment-portfolio',
    name: 'Investment Portfolio Builder',
    tagline: 'Quantum → Legal → Banker → Pulse',
    description:
      'Build a diversified passive-income investment portfolio: Quantum finds current yields, Legal checks tax implications, Banker sets up the accounts, Pulse tracks performance.',
    icon: 'DollarSign',
    color: '#a855f7',
    estimatedMinutes: 6,
    agentsUsed: ['quantum', 'legal', 'banker', 'pulse'],
    prompt:
      'MISSION: Build a passive-income investment portfolio for $10,000. Execute these 4 dispatches:\n\n1. Dispatch Quantum: "Search the web for current passive income options for $10,000 in 2025. Include: dividend stocks (current yields), HYSA rates, treasury bills, REITs, and index funds. Cite real URLs with current rates. Compute 1-year projected income for a diversified split."\n2. After Quantum returns, dispatch Legal: "What are the 2025 US tax implications for each investment type Quantum found? Cover: qualified dividends, interest income, capital gains, REIT distributions. Cite irs.gov sources. Include a disclaimer."\n3. After Legal returns, dispatch Banker: "Recommend specific US banks/brokerages for each investment type. Compare: fees, minimums, APY/rates, and sign-up bonuses. Cite real URLs."\n4. After Banker returns, dispatch Pulse: "Define a quarterly portfolio review dashboard: 5 KPIs (yield, total return, tax drag, allocation drift, rebalance trigger). Set targets."\n\nSynthesize a final portfolio allocation table with expected annual income, tax impact, and setup checklist.',
  },
  {
    id: 'cybersecurity-audit',
    name: 'Cybersecurity Audit',
    tagline: 'Cybersecurity A → Cybersecurity R → Pulse',
    description:
      'Comprehensive security audit: Cybersecurity A identifies vulnerabilities, Cybersecurity R recommends hardening, Pulse defines monitoring KPIs.',
    icon: 'Shield',
    color: '#ef4444',
    estimatedMinutes: 5,
    agentsUsed: ['Cybersecurity A', 'Cybersecurity R', 'pulse'],
    prompt:
      'MISSION: Cybersecurity audit for a small business IT infrastructure. Execute these 3 dispatches:\n\n1. Dispatch Cybersecurity A: "Conduct an offensive security assessment for a small business with: 1 WordPress website, 5 employee laptops, Google Workspace, and Stripe payments. Identify the top 10 vulnerabilities using OWASP Top 10 2025 as framework. Cite real OWASP URLs. For each vuln: risk level, example attack, and affected asset."\n2. After Cybersecurity A returns, dispatch Cybersecurity R: "Based on Cybersecurity A\'s vulnerability list, create a defensive hardening plan. For each vulnerability: specific fix, implementation steps, tools needed, and priority (P0/P1/P2). Include incident response procedures. Cite NIST CSF 2.0 sources."\n3. After Cybersecurity R returns, dispatch Pulse: "Define 5 security KPIs for ongoing monitoring: patch compliance, MFA coverage, backup success rate, phishing test results, incident response time. Set targets and alert thresholds."\n\nSynthesize a final cybersecurity audit report with executive summary, vulnerability matrix, remediation roadmap, and monitoring plan.',
  },
  {
    id: 'content-repurposing',
    name: 'Content Repurposing Engine',
    tagline: 'Scout → Quill → Prism → Aurora',
    description:
      'Turn one idea into 10 pieces of content: Scout finds the trending topic, Quill writes blog + email + tweets, Prism creates social graphics, Aurora designs the monetization.',
    icon: 'Repeat',
    color: '#f472b6',
    estimatedMinutes: 5,
    agentsUsed: ['scout', 'quill', 'prism', 'aurora'],
    prompt:
      'MISSION: Build a content repurposing engine. Execute these 4 dispatches:\n\n1. Dispatch Scout: "Find 1 trending topic this week that has high engagement potential across blog, email, and social. Cite real trending data."\n2. After Scout returns, dispatch Quill: "Based on Scout\'s topic, write: 1 blog post intro (300 words), 1 email newsletter (200 words), 5 tweet variations, and 1 LinkedIn post. All from the same core idea but platform-optimized."\n3. After Quill returns, dispatch Prism: "Generate 3 social media graphics for this content: 1 blog hero image, 1 quote card, 1 infographic-style summary. Cohesive visual brand."\n4. After Aurora returns [wait for prior], dispatch Aurora: "Design the monetization plan for this content cluster: affiliate links to embed, lead magnet to offer, email sequence to nurture, and 30-day revenue projection."\n\nSynthesize a content repurposing playbook the user can repeat weekly.',
  },
]

export function getMissionTemplate(id: string): MissionTemplate | undefined {
  return MISSION_TEMPLATES.find((t) => t.id === id)
}
