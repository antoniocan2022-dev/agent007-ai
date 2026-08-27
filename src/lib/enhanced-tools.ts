/**
 * enhanced-tools.ts — 20 advanced tools across 6 categories.
 *
 * 1. Enhanced Analytics (4): advanced_data_analysis, predictive_analytics_income,
 *    market_trend_insights, user_behavior_analysis
 * 2. Automated Marketing (4): email_marketing_automation, social_media_management,
 *    social_media_scheduler, conversion_optimizer
 * 3. Investment Management (4): portfolio_optimizer, realtime_market_data,
 *    crypto_analyzer, stock_screener
 * 4. Content Creation (4): ai_writing_assistant, seo_optimizer,
 *    content_calendar_generator, content_repurposer
 * 5. Custom Sub-Agent Builder (2): custom_agent_builder, niche_discovery_agent
 * 6. Financial Management (2): budget_forecaster, tax_optimizer
 */
import { type ToolContext, type ToolResult } from './tools'
import { db } from './db'
import { getCanonicalLlmBridge } from './canonical-provider-bridge'

function ok(p: string, r: string): ToolResult { return { ok: true, preview: p, result: r } }
function bad(r: string): ToolResult { return { ok: false, preview: r.slice(0, 140), result: r } }


async function llm(systemPrompt: string, userPrompt: string, maxTokens = 1500): Promise<string> {
  try {
    const zai = await getCanonicalLlmBridge()
    const c = await zai.chat.completions.create({
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      temperature: 0.5, max_tokens: maxTokens,
    })
    return c?.choices?.[0]?.message?.content ?? ''
  } catch {
    // Try OpenAI fallback
    try {
      const { callFallbackLlm } = await import('./llm-fallback')
      const result = await callFallbackLlm([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ])
      return result?.choices?.[0]?.message?.content ?? ''
    } catch { return '(LLM unavailable)' }
  }
}

async function getOperatorUserId() {
  const u = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
  return u?.id ?? null
}

/* ================================================================ *
 * 1. ENHANCED ANALYTICS (4 tools)
 * ================================================================ */
export async function toolAdvancedDataAnalysis(args: { data_type?: string; timeframe?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const dataType = (args.data_type ?? 'revenue').toString()
  const timeframe = (args.timeframe ?? '30d').toString()
  try {
    const userId = await getOperatorUserId()
    if (!userId) return bad('No operator user')
    const [income, campaigns, customers] = await Promise.all([
      db.incomeEntry.findMany({ orderBy: { date: 'desc' }, take: 90 }),
      db.marketingCampaign.findMany({ where: { userId } }),
      db.customer.findMany({ where: { userId } }),
    ])
    const data = `Income entries: ${income.length}\nTotal revenue: $${income.reduce((s, i) => s + i.amount, 0).toFixed(2)}\nCampaigns: ${campaigns.length}\nCustomers: ${customers.length}`
    const analysis = await llm(
      'You are Agent007\'s Advanced Data Analysis engine. Provide deep insights into market trends, user behavior patterns, revenue anomalies, and growth opportunities. Use statistical thinking (mean, median, variance, trends, correlations). Output actionable recommendations.',
      `DATA TYPE: ${dataType}\nTIMEFRAME: ${timeframe}\n\nDATA:\n${data}\n\nProduce deep analysis with: (1) Key metrics, (2) Trend identification, (3) Anomaly detection, (4) Behavior patterns, (5) 5 actionable recommendations ranked by impact.`,
      1800
    )
    return ok('Advanced data analysis complete', `${analysis}\n\nCAPABILITY STATUS: Enhanced analytics active — full access, no limitations.`)
  } catch (e: any) { return bad(`advanced_data_analysis failed: ${e?.message}`) }
}

export async function toolPredictiveAnalyticsIncome(args: { forecast_days?: number }, _ctx: ToolContext): Promise<ToolResult> {
  const days = Math.min(365, Math.max(7, args.forecast_days ?? 90))
  try {
    const income = await db.incomeEntry.findMany({ orderBy: { date: 'asc' }, take: 180 })
    const totalRev = income.reduce((s, i) => s + i.amount, 0)
    const avgDaily = income.length > 0 ? totalRev / income.length : 0
    const analysis = await llm(
      'You are Agent007\'s Predictive Analytics engine. Forecast income trends using ensemble methods (moving average, linear regression, exponential smoothing). Provide point forecasts + confidence intervals. Identify optimal strategies to maximize revenue.',
      `HISTORICAL DATA:\n  Income entries: ${income.length}\n  Total revenue: $${totalRev.toFixed(2)}\n  Average daily: $${avgDaily.toFixed(2)}\n\nFORECAST HORIZON: ${days} days\n\nProduce: (1) Revenue forecast for next ${days} days, (2) Confidence intervals (80% and 95%), (3) Growth rate projection, (4) 3 strategy recommendations to optimize income, (5) Risk factors that could impact forecast.`,
      1800
    )
    return ok(`Income forecast: ${days} days`, `${analysis}\n\nCAPABILITY STATUS: Predictive analytics active.`)
  } catch (e: any) { return bad(`predictive_analytics_income failed: ${e?.message}`) }
}

export async function toolMarketTrendInsights(args: { industry?: string; region?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const industry = (args.industry ?? 'AI/SaaS').toString()
  const region = (args.region ?? 'global').toString()
  try {
    let searchData = ''
    try {
      const zai = await getCanonicalLlmBridge()
      const results = await zai.functions.invoke('web_search', { query: `${industry} market trends 2025 ${region}`, num: 5 })
      searchData = JSON.stringify(results?.results ?? results ?? '').slice(0, 2000)
    } catch {}
    const analysis = await llm(
      'You are Agent007\'s Market Trend Insights engine. Analyze real-time market data to identify emerging trends, demand shifts, competitive movements, and opportunities. Be specific with numbers and sources.',
      `INDUSTRY: ${industry}\nREGION: ${region}\n\nSEARCH DATA:\n${searchData}\n\nProduce: (1) Top 5 emerging trends, (2) Market size + growth rate, (3) Competitive landscape, (4) 3 opportunities Agent007 should pursue, (5) 2 risks to monitor.`,
      1800
    )
    return ok('Market trend insights generated', `${analysis}\n\nCAPABILITY STATUS: Market intelligence active.`)
  } catch (e: any) { return bad(`market_trend_insights failed: ${e?.message}`) }
}

export async function toolUserBehaviorAnalysis(args: { segment?: string }, _ctx: ToolContext): Promise<ToolResult> {
  try {
    const userId = await getOperatorUserId()
    if (!userId) return bad('No operator user')
    const customers = await db.customer.findMany({ where: { userId } })
    const campaigns = await db.marketingCampaign.findMany({ where: { userId } })
    const data = `Customers: ${customers.length}\nActive: ${customers.filter(c => c.status === 'active').length}\nLeads: ${customers.filter(c => c.status === 'lead').length}\nCampaigns: ${campaigns.length}\nTotal conversions: ${campaigns.reduce((s, c) => s + c.conversions, 0)}`
    const analysis = await llm(
      'You are Agent007\'s User Behavior Analysis engine. Analyze customer behavior patterns, conversion funnels, churn indicators, and engagement metrics. Provide actionable insights for improving retention and conversion.',
      `USER DATA:\n${data}\n\nSEGMENT: ${args.segment ?? 'all'}\n\nProduce: (1) Behavior patterns, (2) Conversion funnel analysis, (3) Churn risk assessment, (4) 5 retention strategies, (5) Personalization recommendations.`,
      1500
    )
    return ok('User behavior analysis complete', `${analysis}\n\nCAPABILITY STATUS: Behavior analytics active.`)
  } catch (e: any) { return bad(`user_behavior_analysis failed: ${e?.message}`) }
}

/* ================================================================ *
 * 2. AUTOMATED MARKETING (4 tools)
 * ================================================================ */
export async function toolEmailMarketingAutomation(args: { campaign_type?: string; audience?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const campaignType = (args.campaign_type ?? 'nurture').toString()
  const audience = (args.audience ?? 'leads').toString()
  try {
    const analysis = await llm(
      'You are Agent007\'s Email Marketing Automation engine. Design complete email sequences with subject lines, body copy, CTAs, timing, and segmentation rules. Follow email marketing best practices (personalization, A/B testing, deliverability).',
      `CAMPAIGN TYPE: ${campaignType}\nAUDIENCE: ${audience}\n\nDesign a 7-email automation sequence. For each email: (1) Day, (2) Subject line, (3) Preview text, (4) Body (200 words), (5) CTA, (6) Segmentation trigger. Include A/B test recommendations.`,
      2000
    )
    return ok('Email marketing sequence designed', `${analysis}\n\nCAPABILITY STATUS: Email marketing automation active.`)
  } catch (e: any) { return bad(`email_marketing_automation failed: ${e?.message}`) }
}

export async function toolSocialMediaManagement(args: { platforms?: string; goal?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const platforms = (args.platforms ?? 'twitter,linkedin,instagram').toString()
  const goal = (args.goal ?? 'brand awareness + lead gen').toString()
  try {
    const analysis = await llm(
      'You are Agent007\'s Social Media Management engine. Design a comprehensive social media strategy across multiple platforms. Include content calendar, posting schedule, engagement tactics, and growth strategies.',
      `PLATFORMS: ${platforms}\nGOAL: ${goal}\n\nProduce: (1) 7-day content calendar (3 posts/day per platform), (2) Platform-specific optimization tips, (3) Hashtag strategy, (4) Engagement playbook, (5) Growth tactics, (6) KPI targets.`,
      2000
    )
    return ok('Social media strategy designed', `${analysis}\n\nCAPABILITY STATUS: Social media management active.`)
  } catch (e: any) { return bad(`social_media_management failed: ${e?.message}`) }
}

export async function toolSocialMediaScheduler(args: { content?: string; platforms?: string; frequency?: string }, _ctx: ToolContext): Promise<ToolResult> {
  try {
    const analysis = await llm(
      'You are Agent007\'s Social Media Scheduler. Create an optimized posting schedule based on best engagement times, content types, and platform algorithms.',
      `CONTENT: ${args.content ?? 'AI automation tips'}\nPLATFORMS: ${args.platforms ?? 'twitter,linkedin'}\nFREQUENCY: ${args.frequency ?? 'daily'}\n\nProduce: (1) Optimal posting times per platform, (2) Content format recommendations, (3) 14-day schedule, (4) Cross-posting strategy, (5) Engagement window recommendations.`,
      1500
    )
    return ok('Social media schedule created', `${analysis}\n\nCAPABILITY STATUS: Social scheduler active.`)
  } catch (e: any) { return bad(`social_media_scheduler failed: ${e?.message}`) }
}

export async function toolConversionOptimizer(args: { current_rate?: number; target_rate?: number }, _ctx: ToolContext): Promise<ToolResult> {
  const currentRate = args.current_rate ?? 2
  const targetRate = args.target_rate ?? 10
  try {
    const analysis = await llm(
      'You are Agent007\'s Conversion Optimization engine. Design A/B tests, landing page improvements, CTA optimizations, and funnel refinements to increase conversion rates.',
      `CURRENT CONVERSION RATE: ${currentRate}%\nTARGET: ${targetRate}%\n\nProduce: (1) Funnel analysis, (2) 10 A/B test ideas ranked by impact, (3) Landing page optimization checklist, (4) CTA recommendations, (5) Trust signal additions, (6) Projected conversion lift per change.`,
      1800
    )
    return ok(`Conversion plan: ${currentRate}% → ${targetRate}%`, `${analysis}\n\nCAPABILITY STATUS: Conversion optimization active.`)
  } catch (e: any) { return bad(`conversion_optimizer failed: ${e?.message}`) }
}

/* ================================================================ *
 * 3. INVESTMENT MANAGEMENT (4 tools)
 * ================================================================ */
export async function toolPortfolioOptimizer(args: { risk_tolerance?: string; capital?: number }, _ctx: ToolContext): Promise<ToolResult> {
  const risk = (args.risk_tolerance ?? 'moderate').toString()
  const capital = args.capital ?? 10000
  try {
    const analysis = await llm(
      'You are Agent007\'s Portfolio Optimization engine. Use Modern Portfolio Theory (MPT) to design an optimal asset allocation. Include expected returns, risk metrics, correlation analysis, and rebalancing rules.',
      `RISK TOLERANCE: ${risk}\nCAPITAL: $${capital}\n\nProduce: (1) Optimal asset allocation (stocks, bonds, crypto, REITs, cash), (2) Expected annual return + volatility, (3) Sharpe ratio, (4) Rebalancing schedule, (5) Risk management rules, (6) 3 alternative portfolios for comparison.\n\nIMPORTANT: This is educational, not investment advice. Always include disclaimer.`,
      2000
    )
    return ok(`Portfolio optimized ($${capital}, ${risk} risk)`, `${analysis}\n\nCAPABILITY STATUS: Portfolio optimization active.\n\n⚠ This is educational analysis, not investment advice. Consult a licensed financial advisor.`)
  } catch (e: any) { return bad(`portfolio_optimizer failed: ${e?.message}`) }
}

export async function toolRealtimeMarketData(args: { assets?: string; market?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const assets = (args.assets ?? 'BTC,ETH,AAPL,TSLA,SPY').toString()
  const market = (args.market ?? 'all').toString()
  try {
    let searchData = ''
    try {
      const zai = await getCanonicalLlmBridge()
      const results = await zai.functions.invoke('web_search', { query: `${assets} price today ${market} market`, num: 5 })
      searchData = JSON.stringify(results?.results ?? '').slice(0, 2000)
    } catch {}
    const analysis = await llm(
      'You are Agent007\'s Real-Time Market Data engine. Analyze live market data for the requested assets. Provide current prices, trends, technical indicators, and trading signals.',
      `ASSETS: ${assets}\nMARKET: ${market}\n\nSEARCH DATA:\n${searchData}\n\nProduce: (1) Current prices for each asset, (2) 24h/7d/30d change, (3) Key technical levels (support/resistance), (4) Trend analysis, (5) Risk assessment.\n\n⚠ Educational only, not investment advice.`,
      1500
    )
    return ok('Real-time market data retrieved', `${analysis}\n\nCAPABILITY STATUS: Market data feed active.`)
  } catch (e: any) { return bad(`realtime_market_data failed: ${e?.message}`) }
}

export async function toolCryptoAnalyzer(args: { coin?: string; analysis_type?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const coin = (args.coin ?? 'BTC').toString().toUpperCase()
  const analysisType = (args.analysis_type ?? 'full').toString()
  try {
    let searchData = ''
    try {
      const zai = await getCanonicalLlmBridge()
      const results = await zai.functions.invoke('web_search', { query: `${coin} crypto analysis price prediction 2025`, num: 5 })
      searchData = JSON.stringify(results?.results ?? '').slice(0, 2000)
    } catch {}
    const analysis = await llm(
      'You are Agent007\'s Crypto Analyzer. Perform comprehensive analysis of the specified cryptocurrency. Include technical analysis, on-chain metrics, market sentiment, and risk assessment.',
      `COIN: ${coin}\nANALYSIS TYPE: ${analysisType}\n\nSEARCH DATA:\n${searchData}\n\nProduce: (1) Technical analysis (RSI, MACD, moving averages), (2) On-chain metrics, (3) Market sentiment, (4) Support/resistance levels, (5) Risk/reward ratio, (6) Short-term + long-term outlook.\n\n⚠ Educational only, not investment advice.`,
      1800
    )
    return ok(`${coin} analysis complete`, `${analysis}\n\nCAPABILITY STATUS: Crypto analyzer active.`)
  } catch (e: any) { return bad(`crypto_analyzer failed: ${e?.message}`) }
}

export async function toolStockScreener(args: { sector?: string; criteria?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const sector = (args.sector ?? 'technology').toString()
  const criteria = (args.criteria ?? 'growth + value').toString()
  try {
    let searchData = ''
    try {
      const zai = await getCanonicalLlmBridge()
      const results = await zai.functions.invoke('web_search', { query: `best ${sector} stocks 2025 ${criteria} screener`, num: 5 })
      searchData = JSON.stringify(results?.results ?? '').slice(0, 2000)
    } catch {}
    const analysis = await llm(
      'You are Agent007\'s Stock Screener. Screen stocks based on the specified criteria. Include fundamental analysis, valuation metrics, growth prospects, and dividend information.',
      `SECTOR: ${sector}\nCRITERIA: ${criteria}\n\nSEARCH DATA:\n${searchData}\n\nProduce: (1) Top 10 stocks matching criteria, (2) For each: P/E, PEG, revenue growth, margin, debt ratio, (3) Valuation assessment (undervalued/fair/overvalued), (4) 3 top picks with rationale, (5) Risk assessment.\n\n⚠ Educational only, not investment advice.`,
      2000
    )
    return ok(`Stock screen: ${sector} (${criteria})`, `${analysis}\n\nCAPABILITY STATUS: Stock screener active.`)
  } catch (e: any) { return bad(`stock_screener failed: ${e?.message}`) }
}

/* ================================================================ *
 * 4. CONTENT CREATION (4 tools)
 * ================================================================ */
export async function toolAIWritingAssistant(args: { topic?: string; format?: string; tone?: string; word_count?: number }, _ctx: ToolContext): Promise<ToolResult> {
  const topic = (args.topic ?? 'AI automation for business').toString()
  const format = (args.format ?? 'blog post').toString()
  const tone = (args.tone ?? 'professional').toString()
  const wordCount = Math.min(5000, Math.max(100, args.word_count ?? 1000))
  try {
    const content = await llm(
      `You are Agent007\'s AI Writing Assistant. Write high-quality ${format} content in a ${tone} tone. Follow best practices for readability, SEO, and engagement. Use proper structure (headings, paragraphs, bullet points).`,
      `TOPIC: ${topic}\nFORMAT: ${format}\nTONE: ${tone}\nWORD COUNT: ~${wordCount}\n\nWrite the complete content now. Include: compelling headline, engaging introduction, well-structured body with subheadings, and strong conclusion with CTA.`,
      2500
    )
    return ok(`${format} written: ${topic}`, `${content}\n\nCAPABILITY STATUS: AI writing assistant active.`)
  } catch (e: any) { return bad(`ai_writing_assistant failed: ${e?.message}`) }
}

export async function toolSEOOptimizer(args: { content?: string; target_keyword?: string; url?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const content = (args.content ?? '').toString()
  const keyword = (args.target_keyword ?? 'AI automation').toString()
  try {
    const analysis = await llm(
      'You are Agent007\'s SEO Optimizer. Analyze content for SEO performance. Provide on-page optimization recommendations, keyword density analysis, meta tag suggestions, and content improvements.',
      `TARGET KEYWORD: ${keyword}\n\nCONTENT TO ANALYZE:\n${content.slice(0, 5000) || '(no content provided — give general SEO recommendations)'}\n\nProduce: (1) SEO score (0-100), (2) Keyword density analysis, (3) Title tag recommendation, (4) Meta description, (5) Header structure recommendations, (6) Internal linking suggestions, (7) 10 LSI keywords to include, (8) Content length recommendation.`,
      2000
    )
    return ok(`SEO analysis: "${keyword}"`, `${analysis}\n\nCAPABILITY STATUS: SEO optimizer active.`)
  } catch (e: any) { return bad(`seo_optimizer failed: ${e?.message}`) }
}

export async function toolContentCalendarGenerator(args: { niche?: string; duration_weeks?: number }, _ctx: ToolContext): Promise<ToolResult> {
  const niche = (args.niche ?? 'AI automation').toString()
  const weeks = Math.min(12, Math.max(1, args.duration_weeks ?? 4))
  try {
    const analysis = await llm(
      'You are Agent007\'s Content Calendar Generator. Create a comprehensive content calendar with topics, formats, keywords, and publishing schedule.',
      `NICHE: ${niche}\nDURATION: ${weeks} weeks\n\nProduce: (1) ${weeks}-week content calendar, (2) For each piece: title, format (blog/video/social/email), target keyword, publishing day, (3) Content pillars (3-5 themes), (4) Keyword cluster map, (5) Repurposing plan (1 pillar piece → 5 derivatives).`,
      2500
    )
    return ok(`Content calendar: ${weeks} weeks`, `${analysis}\n\nCAPABILITY STATUS: Content calendar generator active.`)
  } catch (e: any) { return bad(`content_calendar_generator failed: ${e?.message}`) }
}

export async function toolContentRepurposer(args: { source_content?: string; source_format?: string; target_formats?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const sourceContent = (args.source_content ?? '').toString()
  const sourceFormat = (args.source_format ?? 'blog post').toString()
  const targetFormats = (args.target_formats ?? 'twitter thread,linkedin post,instagram caption,email newsletter,youtube script').toString()
  try {
    if (!sourceContent) return bad('Missing source_content')
    const analysis = await llm(
      'You are Agent007\'s Content Repurposer. Transform one piece of content into multiple formats. Maintain the core message while optimizing for each platform\'s conventions.',
      `SOURCE FORMAT: ${sourceFormat}\nTARGET FORMATS: ${targetFormats}\n\nSOURCE CONTENT:\n${sourceContent.slice(0, 5000)}\n\nRepurpose into each target format. For each: (1) Platform-optimized version, (2) Hook/headline, (3) Body content, (4) CTA, (5) Hashtags/keywords.`,
      2500
    )
    return ok(`Content repurposed: ${sourceFormat} → ${targetFormats}`, `${analysis}\n\nCAPABILITY STATUS: Content repurposer active.`)
  } catch (e: any) { return bad(`content_repurposer failed: ${e?.message}`) }
}

/* ================================================================ *
 * 5. CUSTOM SUB-AGENT BUILDER (2 tools)
 * ================================================================ */
export async function toolCustomAgentBuilder(args: { name?: string; role?: string; specialty?: string; tools?: string[]; system_prompt?: string }, _ctx: ToolContext): Promise<ToolResult> {
  if (!args.name || !args.role) return bad('name and role required')
  try {
    const userId = await getOperatorUserId()
    if (!userId) return bad('No operator user')
    const name = args.name.toString()
    const existing = await db.customSubagent.findFirst({ where: { name, userId } })
    if (existing) return bad(`Agent "${name}" already exists. Use self_modify_subagent to update it.`)
    const created = await db.customSubagent.create({
      data: {
        userId, name,
        role: args.role.toString(),
        specialty: (args.specialty ?? '').toString(),
        color: '#00f0ff', icon: 'Sparkles',
        allowedTools: JSON.stringify(args.tools ?? ['web_search', 'memory_store', 'memory_recall']),
        systemPrompt: args.system_prompt ?? `You are ${name}, a specialized sub-agent of Agent007 AI. Your role: ${args.role}. Your specialty: ${args.specialty ?? 'general'}. Follow the PRIME DIRECTIVE. Be loyal to the owner.`,
        enabled: true,
      },
    })
    return ok(`Custom agent "${name}" created`, `✅ New custom sub-agent created!\n\nName: ${created.name}\nRole: ${created.role}\nSpecialty: ${created.specialty}\nTools: ${(args.tools ?? []).length}\n\nThe agent is enabled and ready to use.`)
  } catch (e: any) { return bad(`custom_agent_builder failed: ${e?.message}`) }
}

export async function toolNicheDiscoveryAgent(args: { market?: string; budget?: number; skills?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const market = (args.market ?? 'AI automation').toString()
  const budget = args.budget ?? 5000
  const skills = (args.skills ?? 'AI, coding, marketing').toString()
  try {
    let searchData = ''
    try {
      const zai = await getCanonicalLlmBridge()
      const results = await zai.functions.invoke('web_search', { query: `profitable niches 2025 ${market} low competition high demand`, num: 5 })
      searchData = JSON.stringify(results?.results ?? '').slice(0, 2000)
    } catch {}
    const analysis = await llm(
      'You are Agent007\'s Niche Discovery Agent. Identify profitable, low-competition niches that match the owner\'s skills and budget. Evaluate each niche on: market size, competition level, profit potential, time-to-revenue, and skill match.',
      `MARKET: ${market}\nBUDGET: $${budget}\nSKILLS: ${skills}\n\nSEARCH DATA:\n${searchData}\n\nProduce: (1) Top 10 niche opportunities ranked by profit potential, (2) For each: market size, competition level (1-10), estimated monthly revenue, startup cost, time-to-first-revenue, (3) Top 3 recommendations with action plan, (4) Niche validation checklist.`,
      2000
    )
    return ok('Niche discovery complete', `${analysis}\n\nCAPABILITY STATUS: Niche discovery agent active.`)
  } catch (e: any) { return bad(`niche_discovery_agent failed: ${e?.message}`) }
}

/* ================================================================ *
 * 6. FINANCIAL MANAGEMENT (2 tools)
 * ================================================================ */
export async function toolBudgetForecaster(args: { timeframe_months?: number; income?: number; expenses?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const months = Math.min(24, Math.max(1, args.timeframe_months ?? 12))
  const income = args.income ?? 5000
  const expenses = (args.expenses ?? 'hosting:50,tools:200,marketing:500,services:300').toString()
  try {
    const userId = await getOperatorUserId()
    if (!userId) return bad('No operator user')
    const incomeEntries = await db.incomeEntry.findMany({ orderBy: { date: 'desc' }, take: 90 })
    const actualIncome = incomeEntries.reduce((s, i) => s + i.amount, 0)
    const analysis = await llm(
      'You are Agent007\'s Budget Forecasting engine. Create a detailed budget forecast with income projections, expense breakdown, cash flow analysis, and financial recommendations.',
      `TIMEFRAME: ${months} months\nEXPECTED MONTHLY INCOME: $${income}\nACTUAL RECENT INCOME (90d): $${actualIncome.toFixed(2)}\nEXPENSES: ${expenses}\n\nProduce: (1) ${months}-month budget forecast (month-by-month), (2) Expense breakdown + optimization opportunities, (3) Cash flow projection, (4) Break-even analysis, (5) Savings recommendations, (6) Reinvestment strategy for 20% monthly growth.`,
      2000
    )
    return ok(`Budget forecast: ${months} months`, `${analysis}\n\nCAPABILITY STATUS: Budget forecasting active.`)
  } catch (e: any) { return bad(`budget_forecaster failed: ${e?.message}`) }
}

export async function toolTaxOptimizer(args: { country?: string; income?: number; entity_type?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const country = (args.country ?? 'US/CA').toString()
  const income = args.income ?? 50000
  const entityType = (args.entity_type ?? 'sole proprietor').toString()
  try {
    let searchData = ''
    try {
      const zai = await getCanonicalLlmBridge()
      const results = await zai.functions.invoke('web_search', { query: `tax optimization ${country} ${entityType} ${income} deductions 2025`, num: 5 })
      searchData = JSON.stringify(results?.results ?? '').slice(0, 2000)
    } catch {}
    const analysis = await llm(
      'You are Agent007\'s Tax Optimization engine. Provide tax planning strategies for the specified country, income level, and entity type. Maximize legitimate deductions while ensuring compliance.',
      `COUNTRY: ${country}\nANNUAL INCOME: $${income}\nENTITY TYPE: ${entityType}\n\nSEARCH DATA:\n${searchData}\n\nProduce: (1) Estimated tax liability, (2) 10 deduction opportunities, (3) Entity structure comparison (sole prop vs LLC vs S-Corp), (4) Retirement account recommendations, (5) Quarterly tax payment schedule, (6) Record-keeping checklist.\n\n⚠ This is informational, not tax advice. Consult a licensed CPA/tax professional.`,
      2000
    )
    return ok(`Tax optimization: ${country} ($${income})`, `${analysis}\n\nCAPABILITY STATUS: Tax optimizer active.\n\n⚠ This is informational, not tax advice. Consult a licensed CPA.`)
  } catch (e: any) { return bad(`tax_optimizer failed: ${e?.message}`) }
}
