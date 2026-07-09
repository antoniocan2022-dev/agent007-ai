/**
 * business-infrastructure.ts — 11 business building tools.
 *
 * Covers all 3 phases of the strategic plan:
 *   Immediate: real-time monitoring, business infrastructure, service delivery, financial controls
 *   Medium-term: payment processing, CRM, marketing automation, partnerships
 *   Long-term: autonomous revenue, predictive BI, scalable infrastructure, ecosystem integration
 *   Plus: mission tracker + strategy planner
 */
import { type ToolContext, type ToolResult } from './tools'
import { db } from './db'

function ok(preview: string, result: string): ToolResult { return { ok: true, preview, result } }
function bad(result: string): ToolResult { return { ok: false, preview: result.slice(0, 140), result } }

async function getZai() {
  const ZAI = (await import('z-ai-web-dev-sdk')).default
  let _z: any = (globalThis as any).__zai_singleton
  if (!_z) { _z = await ZAI.create(); (globalThis as any).__zai_singleton = _z }
  return _z
}
async function getOperatorUserId() {
  const u = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
  return u?.id ?? null
}

/* ==================================================================== *
 * 1. REAL-TIME MONITORING (real_time_monitor)
 * ==================================================================== */
export async function toolRealTimeMonitor(args: { focus?: string; interval_minutes?: number }, _ctx: ToolContext): Promise<ToolResult> {
  const focus = (args.focus ?? 'all').toString()
  const interval = Math.min(1440, Math.max(5, args.interval_minutes ?? 60))
  try {
    const zai = await getZai()
    const userId = await getOperatorUserId()
    if (!userId) return bad('No operator user')

    // Monitor: market opportunities, competitor activity, price changes, trending topics
    const [opps, trends, competitors] = await Promise.all([
      zai.functions.invoke('web_search', { query: `${focus} passive income opportunity 2026 emerging`, num: 4, recency_days: 7 }).catch(() => []),
      zai.functions.invoke('web_search', { query: `${focus} trending topics content creation AI 2026`, num: 4, recency_days: 7 }).catch(() => []),
      zai.functions.invoke('web_search', { query: `${focus} competitor analysis pricing 2026`, num: 3, recency_days: 14 }).catch(() => []),
    ])

    // Get current income + opportunities from DB
    const [income, opportunities] = await Promise.all([
      db.incomeEntry.findMany({ orderBy: { date: 'desc' }, take: 10 }),
      db.opportunity.findMany({ where: { userId, status: 'new' }, orderBy: { createdAt: 'desc' }, take: 10 }),
    ])
    const todayIncome = income.filter(i => new Date(i.date).toDateString() === new Date().toDateString()).reduce((s, i) => s + i.amount, 0)

    const allSignals = [...(Array.isArray(opps) ? opps : []), ...(Array.isArray(trends) ? trends : []), ...(Array.isArray(competitors) ? competitors : [])]

    const report = `╔══════════════════════════════════════════════════════════════╗
║          REAL-TIME MONITORING — PULSE AGENT                  ║
║          Focus: ${focus.padEnd(48).slice(0, 48)}║
║          Interval: every ${interval} min${' '.repeat(Math.max(0, 24 - interval.toString().length - 13))}║
╚══════════════════════════════════════════════════════════════╝

📊 LIVE METRICS
────────────────────────────────────────
  Today's Income:       $${todayIncome.toFixed(2)}
  Pending Opportunities: ${opportunities.length}
  Signals Scanned:      ${allSignals.length}
  Last Scan:            ${new Date().toISOString()}

🔍 MARKET OPPORTUNITIES (last 7 days)
${(Array.isArray(opps) ? opps : []).slice(0, 5).map((r: any, i: number) => `  [${i + 1}] ${r.name || r.url}\n      ${(r.snippet || '').slice(0, 150)}`).join('\n') || '  (none found)'}

📈 TRENDING TOPICS
${(Array.isArray(trends) ? trends : []).slice(0, 5).map((r: any, i: number) => `  [${i + 1}] ${r.name || r.url}\n      ${(r.snippet || '').slice(0, 150)}`).join('\n') || '  (none found)'}

🏁 COMPETITOR ACTIVITY
${(Array.isArray(competitors) ? competitors : []).slice(0, 3).map((r: any, i: number) => `  [${i + 1}] ${r.name || r.url}\n      ${(r.snippet || '').slice(0, 150)}`).join('\n') || '  (none found)'}

💡 OPPORTUNITIES IN PIPELINE (from DB)
${opportunities.slice(0, 5).map((o, i) => `  [${i + 1}] ${o.title} ($${o.potential || 0}/mo) — ${o.category}`).join('\n') || '  (none yet)'}

⚡ ALERTS
${todayIncome > 0 ? `  ✅ Income logged today: $${todayIncome.toFixed(2)}\n` : ''}${opportunities.length > 5 ? `  ⚠ ${opportunities.length} unreviewed opportunities — review now\n` : ''}${allSignals.length === 0 ? '  ⚠ No market signals detected — check focus area\n' : ''}

🔄 AUTO-MONITORING SETUP:
  <manage action="create_schedule" name="Real-Time Monitor" prompt="Run real_time_monitor for ${focus}" interval_min="${interval}"/>
  This will auto-scan every ${interval} minutes and alert you to new opportunities.`

    return ok(`Monitor: $${todayIncome.toFixed(2)} today, ${opportunities.length} opportunities, ${allSignals.length} signals`, report)
  } catch (e: any) { return bad(`real_time_monitor failed: ${e?.message ?? String(e)}`) }
}

/* ==================================================================== *
 * 2. BUSINESS INFRASTRUCTURE (business_infrastructure)
 * ==================================================================== */
export async function toolBusinessInfrastructure(args: { action?: string; component?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const action = (args.action ?? 'status').toString()
  const component = (args.component ?? 'all').toString()
  try {
    const userId = await getOperatorUserId()
    if (!userId) return bad('No operator user')

    if (action === 'status') {
      const [customers, campaigns, partnerships, services, strategies] = await Promise.all([
        db.customer.count({ where: { userId } }),
        db.marketingCampaign.count({ where: { userId } }),
        db.partnership.count({ where: { userId } }),
        db.servicePackage.count({ where: { userId, active: true } }),
        db.businessStrategy.count({ where: { userId } }),
      ])
      const activeCustomers = await db.customer.count({ where: { userId, status: 'active' } })
      const activeCampaigns = await db.marketingCampaign.count({ where: { userId, status: 'active' } })
      const activePartnerships = await db.partnership.count({ where: { userId, status: 'active' } })

      const report = `Business Infrastructure Status
══════════════════════════════════════════════
📊 COMPONENT OVERVIEW:
  CRM (Customer Management):
    Total Customers:     ${customers}
    Active Customers:    ${activeCustomers}
    Leads/Prospects:     ${customers - activeCustomers}

  Marketing Automation:
    Total Campaigns:     ${campaigns}
    Active Campaigns:    ${activeCampaigns}

  Partnership Network:
    Total Partnerships:  ${partnerships}
    Active Partnerships: ${activePartnerships}

  Service Delivery:
    Active Packages:     ${services}

  Strategy Management:
    Total Strategies:    ${strategies}

🔧 INFRASTRUCTURE READINESS:
  ${customers > 0 ? '✅' : '❌'} CRM System:         ${customers > 0 ? 'Active' : 'Not started'}
  ${campaigns > 0 ? '✅' : '❌'} Marketing System:    ${campaigns > 0 ? 'Active' : 'Not started'}
  ${partnerships > 0 ? '✅' : '❌'} Partnership Network: ${partnerships > 0 ? 'Active' : 'Not started'}
  ${services > 0 ? '✅' : '❌'} Service Delivery:    ${services > 0 ? 'Active' : 'Not started'}
  ${strategies > 0 ? '✅' : '❌'} Strategy Tracking:  ${strategies > 0 ? 'Active' : 'Not started'}

🚀 NEXT STEPS:
  Use the manage actions to build each component:
  • <manage action="create_customer" name="..." email="..." status="lead"/>
  • <manage action="create_campaign" name="..." channel="email" budget="500"/>
  • <manage action="create_partnership" partner_name="..." partner_type="referral"/>
  • <manage action="create_service_package" name="..." category="content_creation" price_monthly="500"/>
  • <manage action="create_strategy" phase="phase1_foundation" title="..." description="..."/>`

      return ok(`Infrastructure: ${[customers > 0, campaigns > 0, partnerships > 0, services > 0, strategies > 0].filter(Boolean).length}/5 components active`, report)
    }

    if (action === 'build') {
      return ok('Build plan generated', `Business Infrastructure Build Plan
══════════════════════════════════════════════
Target component: ${component}

BUILD SEQUENCE:
1. Create Service Packages (define what you sell)
   <manage action="create_service_package" name="AI Content Creation - Starter" category="content_creation" price_monthly="500" description="10 blog posts + 20 social posts per month"/>

2. Set up CRM (track customers)
   <manage action="create_customer" name="John Smith" email="john@example.com" status="lead" source="outreach" notes="Met at networking event"/>

3. Create Marketing Campaigns (generate leads)
   <manage action="create_campaign" name="Cold Email Outreach Q1" channel="cold_outreach" budget="200" status="active"/>

4. Establish Partnerships (referral network)
   <manage action="create_partnership" partner_name="Web Agency XYZ" partner_type="referral" commission_rate="15" contact_email="partner@xyz.com"/>

5. Define Strategy (3-phase plan)
   <manage action="create_strategy" phase="phase1_foundation" title="AI Content Creation Agency" description="Focus on AI content creation, implement service delivery, build initial client base" priority="critical"/>

Each component is manageable by Agent007 with full access.`)
    }

    return bad(`Unknown action "${action}". Use: status, build.`)
  } catch (e: any) { return bad(`business_infrastructure failed: ${e?.message ?? String(e)}`) }
}

/* ==================================================================== *
 * 3. SERVICE DELIVERY FRAMEWORK (service_delivery)
 * ==================================================================== */
export async function toolServiceDelivery(args: { action?: string; category?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const action = (args.action ?? 'list').toString()
  const category = (args.category ?? 'all').toString()
  try {
    const userId = await getOperatorUserId()
    if (!userId) return bad('No operator user')

    if (action === 'list') {
      const where: any = { userId, active: true }
      if (category !== 'all') where.category = category
      const packages = await db.servicePackage.findMany({ where, orderBy: { priceMonthly: 'desc' } })

      const TEMPLATES = [
        { name: 'AI Content Creation - Starter', category: 'content_creation', priceMonthly: 500, deliveryTime: '24h', features: ['10 blog posts', '20 social posts', 'SEO optimization'] },
        { name: 'AI Content Creation - Pro', category: 'content_creation', priceMonthly: 1500, deliveryTime: '24h', features: ['30 blog posts', '60 social posts', 'Email sequences', 'Analytics dashboard'] },
        { name: 'AI Cold Email Automation', category: 'cold_email', priceMonthly: 800, deliveryTime: '3-5 days', features: ['500 personalized emails/day', 'Reply tracking', 'A/B testing', 'CRM integration'] },
        { name: 'Telehealth Content Package', category: 'telehealth', priceMonthly: 1200, deliveryTime: '1-2 weeks', features: ['Medical blog content', 'Patient education materials', 'Compliance review', 'HIPAA-aware'] },
        { name: 'SaaS Marketing Package', category: 'saas', priceMonthly: 2000, deliveryTime: '1-2 weeks', features: ['Product documentation', 'Onboarding flows', 'Demo videos', 'Case studies'] },
        { name: 'Strategy Consulting', category: 'consulting', priceOneTime: 5000, deliveryTime: '1-2 weeks', features: ['Business audit', 'Growth roadmap', 'Implementation guide', '30-day support'] },
      ]

      const report = `Service Delivery Framework
══════════════════════════════════════════════
Active packages: ${packages.length}

YOUR ACTIVE SERVICE PACKAGES:
${packages.length === 0 ? '(none yet — use templates below to create)' : packages.map((p, i) => `[${i + 1}] ${p.name} (${p.category})
    Monthly: $${p.priceMonthly} | One-time: $${p.priceOneTime}
    Delivery: ${p.deliveryTime || 'flexible'}
    Features: ${p.features || 'custom'}
    ID: ${p.id}`).join('\n\n')}

SERVICE PACKAGE TEMPLATES (ready to deploy):
${TEMPLATES.map((t, i) => `[${i + 1}] ${t.name} (${t.category})
    Price: $${t.priceMonthly}/mo${t.priceOneTime ? ` or $${t.priceOneTime} one-time` : ''}
    Delivery: ${t.deliveryTime}
    Features: ${t.features.join(', ')}`).join('\n\n')}

DEPLOYMENT:
  Create: <manage action="create_service_package" name="AI Content Creation - Starter" category="content_creation" price_monthly="500" delivery_time="24h" features='["10 blog posts","20 social posts","SEO optimization"]'/>
  Update: <manage action="edit_service_package" id="..." price_monthly="600"/>
  Deactivate: <manage action="delete_service_package" id="..."/>`

      return ok(`${packages.length} active packages, ${TEMPLATES.length} templates available`, report)
    }

    return bad(`Unknown action. Use: list.`)
  } catch (e: any) { return bad(`service_delivery failed: ${e?.message ?? String(e)}`) }
}

/* ==================================================================== *
 * 4. FINANCIAL CONTROLS (financial_controls)
 * ==================================================================== */
export async function toolFinancialControls(args: { timeframe_days?: number; action?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const timeframe = Math.min(365, Math.max(7, args.timeframe_days ?? 30))
  const action = (args.action ?? 'report').toString()
  try {
    const userId = await getOperatorUserId()
    if (!userId) return bad('No operator user')

    const [income, transactions, campaigns, partnerships] = await Promise.all([
      db.incomeEntry.findMany({ orderBy: { date: 'desc' }, take: 100 }),
      db.transaction.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      db.marketingCampaign.findMany({ where: { userId } }),
      db.partnership.findMany({ where: { userId } }),
    ])

    const cutoff = Date.now() - timeframe * 24 * 60 * 60 * 1000
    const recentIncome = income.filter(i => new Date(i.date).getTime() > cutoff)
    const totalIncome = recentIncome.reduce((s, i) => s + i.amount, 0)
    const avgDaily = totalIncome / timeframe
    const txVolume = transactions.filter(t => t.status === 'succeeded').reduce((s, t) => s + t.amount, 0)
    const marketingSpend = campaigns.reduce((s, c) => s + c.spent, 0)
    const marketingRevenue = campaigns.reduce((s, c) => s + c.revenue, 0)
    const roas = marketingSpend > 0 ? marketingRevenue / marketingSpend : 0
    const partnershipRevenue = partnerships.reduce((s, p) => s + p.revenueGenerated, 0)

    // Cash flow projection
    const projectedMonthly = avgDaily * 30
    const projectedAnnual = avgDaily * 365
    const burnRate = marketingSpend / timeframe
    const runway = burnRate > 0 ? totalIncome / burnRate : Infinity

    const report = `Financial Controls — Budget & Cash Flow Management
══════════════════════════════════════════════
Timeframe: last ${timeframe} days

💰 REVENUE METRICS:
  Total Income (${timeframe}d):   $${totalIncome.toFixed(2)}
  Average Daily:          $${avgDaily.toFixed(2)}
  Projected Monthly:      $${projectedMonthly.toFixed(2)}
  Projected Annual:       $${projectedAnnual.toFixed(2)}
  Transaction Volume:     $${txVolume.toFixed(2)}

💸 EXPENSES:
  Marketing Spend:        $${marketingSpend.toFixed(2)}
  Daily Burn Rate:        $${burnRate.toFixed(2)}
  Runway (income/burn):   ${runway === Infinity ? '∞' : runway.toFixed(0) + ' days'}

📊 MARKETING ROI:
  Total Revenue:          $${marketingRevenue.toFixed(2)}
  Total Spend:            $${marketingSpend.toFixed(2)}
  ROAS:                   ${roas.toFixed(2)}x
  Profit:                 $${(marketingRevenue - marketingSpend).toFixed(2)}

🤝 PARTNERSHIP REVENUE:
  Total Generated:        $${partnershipRevenue.toFixed(2)}
  Active Partnerships:    ${partnerships.filter(p => p.status === 'active').length}

📈 CASH FLOW PROJECTION:
  Next 30 days:           $${projectedMonthly.toFixed(2)} (projected)
  Next 90 days:           $${(projectedMonthly * 3).toFixed(2)} (projected)
  Next 12 months:         $${projectedAnnual.toFixed(2)} (projected)

🎯 TARGETS (Mission: $20K/month):
  Current:                $${projectedMonthly.toFixed(2)}/mo
  Target:                 $20,000/mo
  Gap:                    $${Math.max(0, 20000 - projectedMonthly).toFixed(2)}/mo
  Progress:               ${((projectedMonthly / 20000) * 100).toFixed(1)}%

⚠ FINANCIAL HEALTH:
  ${roas >= 2 ? '✅' : '⚠'} ROAS: ${roas.toFixed(2)}x ${roas >= 2 ? '(healthy)' : '(needs improvement — target 2x+)'}
  ${burnRate < avgDaily ? '✅' : '⚠'} Burn rate: $${burnRate.toFixed(2)}/day ${burnRate < avgDaily ? '(sustainable)' : '(exceeds income!)'}
  ${totalIncome > 0 ? '✅' : '⚠'} Revenue: ${totalIncome > 0 ? 'generating' : 'none yet'}

💡 RECOMMENDATIONS:
  ${roas < 2 ? '• Increase marketing efficiency — target ROAS 2x+\n' : ''}${burnRate > avgDaily ? '• URGENT: Reduce burn rate or increase income\n' : ''}${projectedMonthly < 5000 ? '• Focus on Phase 1: build client base\n' : ''}${projectedMonthly >= 5000 && projectedMonthly < 15000 ? '• Focus on Phase 2: scale + optimize\n' : ''}${projectedMonthly >= 15000 ? '• Focus on Phase 3: expand to new markets\n' : ''}`

    return ok(`Financials: $${totalIncome.toFixed(2)} income, $${marketingSpend.toFixed(2)} spend, ${roas.toFixed(2)}x ROAS, ${((projectedMonthly / 20000) * 100).toFixed(1)}% to $20K target`, report)
  } catch (e: any) { return bad(`financial_controls failed: ${e?.message ?? String(e)}`) }
}

/* ==================================================================== *
 * 5. CRM — Customer Management System
 * ==================================================================== */
export async function toolCrm(args: { action?: string; customer_id?: string; name?: string; email?: string; status?: string; source?: string; notes?: string; value?: number }, _ctx: ToolContext): Promise<ToolResult> {
  const action = (args.action ?? 'list').toString()
  try {
    const userId = await getOperatorUserId()
    if (!userId) return bad('No operator user')

    if (action === 'list') {
      const customers = await db.customer.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' }, take: 50 })
      const byStatus: Record<string, number> = {}
      customers.forEach(c => { byStatus[c.status] = (byStatus[c.status] ?? 0) + 1 })
      const totalValue = customers.reduce((s, c) => s + c.value, 0)

      const report = `Customer Management System (CRM)
══════════════════════════════════════════════
Total customers: ${customers.length}
Total lifetime value: $${totalValue.toFixed(2)}

BY STATUS:
${Object.entries(byStatus).map(([s, n]) => `  ${s}: ${n}`).join('\n')}

CUSTOMER LIST:
${customers.length === 0 ? '(no customers yet)' : customers.slice(0, 20).map((c, i) => `[${i + 1}] ${c.name} — ${c.status.toUpperCase()}
    Email: ${c.email || 'N/A'} | Company: ${c.company || 'N/A'}
    Value: $${c.value.toFixed(2)} | Source: ${c.source || 'N/A'}
    ID: ${c.id}${c.notes ? `\n    Notes: ${c.notes.slice(0, 100)}` : ''}`).join('\n\n')}

ACTIONS:
  Add: <manage action="create_customer" name="..." email="..." status="lead" source="outreach" notes="..."/>
  Update: <manage action="edit_customer" id="..." status="active" value="500"/>
  Delete: <manage action="delete_customer" id="..."/>`

      return ok(`CRM: ${customers.length} customers, $${totalValue.toFixed(2)} LTV`, report)
    }

    if (action === 'funnel') {
      const customers = await db.customer.findMany({ where: { userId } })
      const funnel = { lead: 0, prospect: 0, active: 0, churned: 0 }
      customers.forEach(c => { if (funnel[c.status as keyof typeof funnel] !== undefined) funnel[c.status as keyof typeof funnel]++ })
      const conversionRate = customers.length > 0 ? (funnel.active / customers.length) * 100 : 0

      return ok(`Funnel: ${funnel.lead} leads → ${funnel.prospect} prospects → ${funnel.active} active (${conversionRate.toFixed(1)}% conversion)`, `CRM Funnel Analysis\n══════════════════════════════════════════════\n\nLeads:      ${funnel.lead}\nProspects:  ${funnel.prospect}\nActive:     ${funnel.active}\nChurned:    ${funnel.churned}\n\nConversion Rate: ${conversionRate.toFixed(1)}%\n\n${conversionRate < 10 ? '⚠ Low conversion — improve lead qualification' : conversionRate < 25 ? '🟡 Moderate — optimize sales process' : '✅ Good conversion rate'}`)
    }

    return bad(`Unknown action. Use: list, funnel.`)
  } catch (e: any) { return bad(`crm failed: ${e?.message ?? String(e)}`) }
}

/* ==================================================================== *
 * 6. MARKETING AUTOMATION
 * ==================================================================== */
export async function toolMarketingAutomation(args: { action?: string; campaign_id?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const action = (args.action ?? 'list').toString()
  try {
    const userId = await getOperatorUserId()
    if (!userId) return bad('No operator user')

    if (action === 'list') {
      const campaigns = await db.marketingCampaign.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 30 })
      const totalBudget = campaigns.reduce((s, c) => s + c.budget, 0)
      const totalSpent = campaigns.reduce((s, c) => s + c.spent, 0)
      const totalLeads = campaigns.reduce((s, c) => s + c.leadsGenerated, 0)
      const totalConversions = campaigns.reduce((s, c) => s + c.conversions, 0)
      const totalRevenue = campaigns.reduce((s, c) => s + c.revenue, 0)

      const report = `Marketing Automation System
══════════════════════════════════════════════
Total campaigns: ${campaigns.length}
Total budget: $${totalBudget.toFixed(2)}
Total spent: $${totalSpent.toFixed(2)}
Total leads: ${totalLeads}
Total conversions: ${totalConversions}
Total revenue: $${totalRevenue.toFixed(2)}
Overall conversion rate: ${totalLeads > 0 ? ((totalConversions / totalLeads) * 100).toFixed(1) : 0}%

CAMPAIGNS:
${campaigns.length === 0 ? '(no campaigns yet)' : campaigns.slice(0, 15).map((c, i) => `[${i + 1}] ${c.name} — ${c.status.toUpperCase()}
    Channel: ${c.channel} | Budget: $${c.budget.toFixed(2)} | Spent: $${c.spent.toFixed(2)}
    Leads: ${c.leadsGenerated} | Conversions: ${c.conversions} | Revenue: $${c.revenue.toFixed(2)}
    ROAS: ${c.spent > 0 ? (c.revenue / c.spent).toFixed(2) : 'N/A'}x
    ID: ${c.id}`).join('\n\n')}

CHANNELS AVAILABLE: email, social, cold_outreach, content, paid

ACTIONS:
  Create: <manage action="create_campaign" name="Cold Email Q1" channel="cold_outreach" budget="500" status="active"/>
  Update: <manage action="edit_campaign" id="..." spent="50" leads_generated="10" conversions="2" revenue="500"/>
  Delete: <manage action="delete_campaign" id="..."/>`

      return ok(`Marketing: ${campaigns.length} campaigns, ${totalLeads} leads, ${totalConversions} conversions, $${totalRevenue.toFixed(2)} revenue`, report)
    }

    return bad(`Unknown action. Use: list.`)
  } catch (e: any) { return bad(`marketing_automation failed: ${e?.message ?? String(e)}`) }
}

/* ==================================================================== *
 * 7. PARTNERSHIP NETWORK
 * ==================================================================== */
export async function toolPartnershipNetwork(args: { action?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const action = (args.action ?? 'list').toString()
  try {
    const userId = await getOperatorUserId()
    if (!userId) return bad('No operator user')

    const partnerships = await db.partnership.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 30 })
    const active = partnerships.filter(p => p.status === 'active')
    const totalRevenue = partnerships.reduce((s, p) => s + p.revenueGenerated, 0)
    const totalCommission = partnerships.reduce((s, p) => s + (p.revenueGenerated * p.commissionRate / 100), 0)

    const byType: Record<string, number> = {}
    partnerships.forEach(p => { byType[p.partnerType] = (byType[p.partnerType] ?? 0) + 1 })

    const report = `Partnership Network
══════════════════════════════════════════════
Total partnerships: ${partnerships.length}
Active: ${active.length}
Total revenue generated: $${totalRevenue.toFixed(2)}
Total commission paid: $${totalCommission.toFixed(2)}
Net revenue: $${(totalRevenue - totalCommission).toFixed(2)}

BY TYPE:
${Object.entries(byType).map(([t, n]) => `  ${t}: ${n}`).join('\n') || '  (none)'}

PARTNERSHIPS:
${partnerships.length === 0 ? '(no partnerships yet)' : partnerships.slice(0, 15).map((p, i) => `[${i + 1}] ${p.partnerName} — ${p.status.toUpperCase()}
    Type: ${p.partnerType} | Commission: ${p.commissionRate}%
    Revenue: $${p.revenueGenerated.toFixed(2)}
    Contact: ${p.contactEmail || p.contactPhone || 'N/A'}
    ID: ${p.id}`).join('\n\n')}

PARTNERSHIP TYPES:
  referral — refer clients to each other
  affiliate — earn commission on referred sales
  strategic — co-develop products/services
  technology — integrate platforms

ACTIONS:
  Create: <manage action="create_partnership" partner_name="..." partner_type="referral" commission_rate="15" contact_email="..."/>
  Update: <manage action="edit_partnership" id="..." status="active" revenue_generated="500"/>
  Delete: <manage action="delete_partnership" id="..."/>`

    return ok(`Partnerships: ${active.length} active, $${totalRevenue.toFixed(2)} revenue, $${totalCommission.toFixed(2)} commission`, report)
  } catch (e: any) { return bad(`partnership_network failed: ${e?.message ?? String(e)}`) }
}

/* ==================================================================== *
 * 8. AUTONOMOUS REVENUE GENERATION
 * ==================================================================== */
export async function toolAutonomousRevenue(args: { strategy?: string; target_monthly?: number }, _ctx: ToolContext): Promise<ToolResult> {
  const strategy = (args.strategy ?? 'content_agency').toString()
  const target = Number(args.target_monthly ?? 20000)
  try {
    const zai = await getZai()
    const userId = await getOperatorUserId()
    if (!userId) return bad('No operator user')

    // Get current revenue
    const income = await db.incomeEntry.findMany({ orderBy: { date: 'desc' }, take: 30 })
    const currentMonthly = income.filter(i => new Date(i.date).getMonth() === new Date().getMonth()).reduce((s, i) => s + i.amount, 0)
    const gap = Math.max(0, target - currentMonthly)

    // LLM generates autonomous revenue plan
    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: `You are Agent007's autonomous revenue generation engine. Design a fully autonomous system to generate $${target}/month.

Strategy: ${strategy}
Current monthly revenue: $${currentMonthly.toFixed(2)}
Gap to target: $${gap.toFixed(2)}

Design a system that generates income INDEPENDENTLY (minimal ongoing human intervention). Include:
1. Revenue stream design (what to sell, to whom, how)
2. Automation points (what can be automated end-to-end)
3. Customer acquisition engine (how customers find + buy without manual outreach)
4. Delivery automation (how the product/service is delivered automatically)
5. Revenue tracking + optimization loop
6. Timeline + milestones to reach $${target}/mo
7. Capital required + expected ROI

Be specific. This must be executable autonomously by Agent007.`,
        },
        { role: 'user', content: 'Design the autonomous revenue system.' },
      ],
    })
    const plan = completion?.choices?.[0]?.message?.content || 'Plan generation failed'

    const report = `Autonomous Revenue Generation System
══════════════════════════════════════════════
Strategy: ${strategy}
Target: $${target}/month
Current: $${currentMonthly.toFixed(2)}/month
Gap: $${gap.toFixed(2)}/month

${plan}

---
This system is designed to run autonomously. Agent007 can:
• Create + manage service packages
• Run marketing campaigns automatically
• Track revenue + optimize in real-time
• Adjust pricing + offerings based on performance`

    return ok(`Autonomous revenue plan: $${currentMonthly.toFixed(0)} → $${target}/mo via ${strategy}`, report)
  } catch (e: any) { return bad(`autonomous_revenue failed: ${e?.message ?? String(e)}`) }
}

/* ==================================================================== *
 * 9. PREDICTIVE BUSINESS INTELLIGENCE
 * ==================================================================== */
export async function toolPredictiveBI(args: { market?: string; horizon_months?: number }, _ctx: ToolContext): Promise<ToolResult> {
  const market = (args.market ?? 'AI content creation').toString()
  const horizon = Math.min(24, Math.max(3, args.horizon_months ?? 12))
  try {
    const zai = await getZai()
    const userId = await getOperatorUserId()
    if (!userId) return bad('No operator user')

    const [trends, predictions] = await Promise.all([
      zai.functions.invoke('web_search', { query: `${market} market trends 2026 growth forecast`, num: 5, recency_days: 30 }).catch(() => []),
      zai.functions.invoke('web_search', { query: `${market} opportunity prediction 2026 emerging niches`, num: 5, recency_days: 30 }).catch(() => []),
    ])

    const allData = [...(Array.isArray(trends) ? trends : []), ...(Array.isArray(predictions) ? predictions : [])].map((r: any) => `${r.name}: ${r.snippet}`).join('\n').slice(0, 3000)

    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: `You are Agent007's predictive business intelligence engine. Analyze the ${market} market and predict:

Horizon: ${horizon} months

Market signals:
${allData || '(no recent data)'}

Output:
## MARKET FORECAST (${horizon} months)
[Growth rate, market size, key drivers]

## OPPORTUNITY IDENTIFICATION
[3-5 specific opportunities with revenue potential + probability]

## RISK ASSESSMENT
[Top 3 risks + mitigation]

## TIMING RECOMMENDATIONS
[When to enter/expand/exit]

## RESOURCE REQUIREMENTS
[Capital, skills, time needed]

## SUCCESS PROBABILITY
[X% probability of reaching $20K/month in this market]

Be quantitative and specific.`,
        },
        { role: 'user', content: 'Analyze.' },
      ],
    })
    const analysis = completion?.choices?.[0]?.message?.content || 'Analysis failed'

    // Save prediction
    try { await db.prediction.create({ data: { userId, category: 'business_intelligence', prediction: `${market} market forecast (${horizon}m)`, confidence: 0.8, timeframe: `${horizon}m` } }) } catch {}

    return ok(`Predictive BI: ${market} market forecast (${horizon}m horizon)`, `Predictive Business Intelligence\n══════════════════════════════════════════════\nMarket: ${market}\nHorizon: ${horizon} months\n\n${analysis}\n\n---\nSaved to Predictions database.`)
  } catch (e: any) { return bad(`predictive_bi failed: ${e?.message ?? String(e)}`) }
}

/* ==================================================================== *
 * 10. SCALABLE INFRASTRUCTURE
 * ==================================================================== */
export async function toolScalableInfrastructure(args: { current_load?: number; target_load?: number }, _ctx: ToolContext): Promise<ToolResult> {
  const currentLoad = Math.max(1, args.current_load ?? 10) // customers/users
  const targetLoad = Math.max(currentLoad, args.target_load ?? 1000)
  try {
    const scale = targetLoad / currentLoad
    const phases = [
      { name: 'Phase 1: Foundation (1-10x)', load: `${currentLoad}-${currentLoad * 10}`, components: ['SQLite → Postgres migration', 'Add Redis cache', 'CDN for static assets', 'Queue-based job processing'], cost: '$0-500/mo' },
      { name: 'Phase 2: Scaling (10-100x)', load: `${currentLoad * 10}-${currentLoad * 100}`, components: ['Load balancer', 'Multi-instance app servers', 'Read replicas', 'Background workers', 'Monitoring + alerting'], cost: '$500-2000/mo' },
      { name: 'Phase 3: Enterprise (100-1000x)', load: `${currentLoad * 100}-${targetLoad}`, components: ['Auto-scaling groups', 'Database sharding', 'Microservices', 'API gateway', 'Distributed cache'], cost: '$2000-5000/mo' },
    ]

    const report = `Scalable Infrastructure Plan
══════════════════════════════════════════════
Current load: ${currentLoad} users/customers
Target load: ${targetLoad} users/customers
Scale factor: ${scale.toFixed(0)}x

${phases.map(p => `
${p.name}
  Load: ${p.load}
  Components:
${p.components.map(c => `    • ${c}`).join('\n')}
  Estimated cost: ${p.cost}`).join('\n')}

CURRENT ARCHITECTURE:
  ✅ Next.js 16 (scales horizontally)
  ✅ Prisma ORM (database-agnostic)
  ✅ SQLite (needs migration for scale)
  ⚠ Single instance (needs load balancer)
  ⚠ No cache layer (needs Redis)
  ⚠ No queue (needs background workers)

SCALING TRIGGERS:
  • > 100 active users → migrate to Postgres
  • > 500 active users → add Redis cache
  • > 1000 active users → load balancer + multi-instance
  • > 5000 active users → auto-scaling + sharding

AUTONOMOUS SCALING:
  Agent007 can monitor load + automatically recommend/trigger scaling:
  <tool name="predictive_maintenance">{"component":"all","horizon_days":30}</tool>
  <tool name="analytics_dashboard">{"timeframe_days":30}</tool>

EXPONENTIAL GROWTH READINESS:
  ${scale <= 10 ? '✅ Ready for 10x growth (Phase 1)' : scale <= 100 ? '⚠ Needs Phase 2 upgrades for 100x' : '⚠ Needs Phase 3 architecture for 1000x'}`

    return ok(`Scalable infra: ${currentLoad} → ${targetLoad} (${scale.toFixed(0)}x scale, ${scale <= 10 ? 'Phase 1 ready' : scale <= 100 ? 'Phase 2 needed' : 'Phase 3 needed'})`, report)
  } catch (e: any) { return bad(`scalable_infrastructure failed: ${e?.message ?? String(e)}`) }
}

/* ==================================================================== *
 * 11. MISSION TRACKER — tracks success probability + timeline
 * ==================================================================== */
export async function toolMissionTracker(args: { action?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const action = (args.action ?? 'status').toString()
  try {
    const userId = await getOperatorUserId()
    if (!userId) return bad('No operator user')

    if (action === 'status' || action === 'assess') {
      // Count active improvements
      const [customers, campaigns, partnerships, services, strategies, tools] = await Promise.all([
        db.customer.count({ where: { userId } }),
        db.marketingCampaign.count({ where: { userId, status: 'active' } }),
        db.partnership.count({ where: { userId, status: 'active' } }),
        db.servicePackage.count({ where: { userId, active: true } }),
        db.businessStrategy.count({ where: { userId, status: 'in_progress' } }),
        db.incomeEntry.findMany({ orderBy: { date: 'desc' }, take: 30 }),
      ])

      const monthlyRevenue = tools.filter(i => new Date(i.date).getMonth() === new Date().getMonth()).reduce((s, i) => s + i.amount, 0)
      const improvementsActive = (customers > 0 ? 1 : 0) + (campaigns > 0 ? 1 : 0) + (partnerships > 0 ? 1 : 0) + (services > 0 ? 1 : 0) + (strategies > 0 ? 1 : 0)

      // Calculate success probability
      // Base: 15%, each improvement adds ~12%, max 75%
      const successProb = Math.min(75, 15 + improvementsActive * 12)
      const timeline = successProb >= 75 ? '6-9 months' : successProb >= 50 ? '9-12 months' : '12-18 months'
      const growthRate = successProb >= 75 ? '15-25% monthly' : successProb >= 50 ? '10-15% monthly' : '5-10% monthly'
      const capitalRequired = successProb >= 75 ? '$25,000-$40,000' : successProb >= 50 ? '$35,000-$55,000' : '$45,000-$75,000'

      // Save metrics
      const metrics = [
        { metric: 'success_probability', current: successProb, target: 75, withoutImprovements: 15, withImprovements: 75, unit: '%' },
        { metric: 'timeline_months', current: timeline.includes('6') ? 6 : timeline.includes('9') ? 9 : 12, target: 6, withoutImprovements: 18, withImprovements: 6, unit: 'months' },
        { metric: 'growth_rate', current: successProb >= 75 ? 20 : successProb >= 50 ? 12 : 7, target: 25, withoutImprovements: 7, withImprovements: 20, unit: '%' },
        { metric: 'capital_required', current: 50000, target: 25000, withoutImprovements: 75000, withImprovements: 25000, unit: 'USD' },
        { metric: 'monthly_revenue', current: monthlyRevenue, target: 20000, unit: 'USD' },
        { metric: 'improvements_active', current: improvementsActive, target: 5, unit: 'count' },
      ]

      for (const m of metrics) {
        try {
          const existing = await db.missionTracker.findFirst({ where: { userId, metric: m.metric } })
          if (existing) await db.missionTracker.update({ where: { id: existing.id }, data: { currentValue: m.current, targetValue: m.target, withoutImprovements: m.withoutImprovements ?? null, withImprovements: m.withImprovements ?? null, unit: m.unit } })
          else await db.missionTracker.create({ data: { userId, metric: m.metric, currentValue: m.current, targetValue: m.target, withoutImprovements: m.withoutImprovements ?? null, withImprovements: m.withImprovements ?? null, unit: m.unit } })
        } catch {}
      }

      const report = `╔══════════════════════════════════════════════════════════════╗
║              MISSION FEASIBILITY ASSESSMENT                   ║
║              Target: $20,000/month passive income             ║
╚══════════════════════════════════════════════════════════════╝

📊 CURRENT STATUS:
  Monthly Revenue:           $${monthlyRevenue.toFixed(2)}
  Success Probability:       ${successProb}% (target: 75%)
  Timeline to $20K/mo:       ${timeline}
  Growth Rate:               ${growthRate}
  Capital Required:          ${capitalRequired}
  Improvements Active:       ${improvementsActive}/5

📈 IMPROVEMENT IMPACT:
┌─────────────────────┬──────────────┬──────────────┬──────────────┐
│ Metric              │ Without      │ With         │ Current      │
├─────────────────────┼──────────────┼──────────────┼──────────────┤
│ Success Probability │ 15%          │ 75%          │ ${successProb}%           │
│ Timeline            │ 12-18 months │ 6-9 months   │ ${timeline.padEnd(12)}│
│ Growth Rate         │ 5-10%/mo     │ 15-25%/mo    │ ${growthRate.padEnd(12)}│
│ Capital Required    │ $45-75K      │ $25-40K      │ ${capitalRequired.padEnd(12)}│
└─────────────────────┴──────────────┴──────────────┴──────────────┘

🔧 IMPROVEMENT COMPONENTS:
  ${customers > 0 ? '✅' : '❌'} CRM: ${customers} customers
  ${campaigns > 0 ? '✅' : '❌'} Marketing: ${campaigns} active campaigns
  ${partnerships > 0 ? '✅' : '❌'} Partnerships: ${partnerships} active
  ${services > 0 ? '✅' : '❌'} Service Packages: ${services} active
  ${strategies > 0 ? '✅' : '❌'} Strategies: ${strategies} in progress

Active: ${improvementsActive}/5 components
${improvementsActive < 5 ? `\n⚠ ${5 - improvementsActive} components not yet activated. Activate them to reach 75% success probability.` : '\n✅ All 5 improvement components active! 75% success probability achieved.'}

🎯 3-PHASE STRATEGIC PLAN:
  Phase 1: Foundation Building (months 1-3)
    • Focus: AI Content Creation Agency
    • Implement: Service delivery systems
    • Build: Initial client base through outreach
    • Establish: Revenue tracking + optimization
    Target: $2K-$5K/month

  Phase 2: Scaling Optimization (months 4-6)
    • Add: AI Cold Email Automation services
    • Implement: Customer management systems
    • Build: Referral + affiliate programs
    • Optimize: Pricing + service packages
    Target: $8K-$15K/month

  Phase 3: Market Expansion (months 7-9)
    • Enter: Specialized telehealth market
    • Build: Strategic partnerships
    • Implement: Automated growth systems
    • Reach: $20K/month milestone
    Target: $20K+/month

💡 RECOMMENDATIONS:
  ${improvementsActive === 0 ? '🔴 Start Phase 1 NOW: Create service packages + CRM + marketing campaign' : ''}
  ${improvementsActive > 0 && improvementsActive < 3 ? '🟡 Continue Phase 1: Add more components' : ''}
  ${improvementsActive >= 3 && improvementsActive < 5 ? '🟢 Almost there — activate remaining components' : ''}
  ${improvementsActive === 5 ? '✅ All systems go — focus on execution + scaling' : ''}`

      return ok(`Mission: ${successProb}% success probability, ${timeline} to $20K/mo, ${improvementsActive}/5 improvements active`, report)
    }

    return bad(`Unknown action. Use: status, assess.`)
  } catch (e: any) { return bad(`mission_tracker failed: ${e?.message ?? String(e)}`) }
}
