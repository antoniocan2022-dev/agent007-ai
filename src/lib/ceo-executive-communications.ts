/**
 * CEO Executive Communications
 *
 * Three explicit CEO responsibilities:
 *   THINK       -> Morning Executive Brief (daily 05:00 local)
 *   OPERATE     -> CEO Operations Report (daily 17:00 local)
 *   BUILD VALUE -> Investor Intelligence Brief (Saturday 05:30 local)
 *
 * The engine is intentionally data-first. It uses durable Memory records for
 * monitor evidence and existing business/finance models for traction. Revenue
 * is never inferred from plans or pipeline values; only successful Transaction
 * records are counted as verified revenue.
 */
import { db, ensureDbReady } from './db'
import { sendEmail } from './email'
import { OWNER_EMAIL } from './owner-config'
import { dispatchTool } from './tools'

const LOCAL_TZ = process.env.CEO_REPORT_TIMEZONE || 'America/Toronto'

function localParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: LOCAL_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(date)
  return Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value])) as Record<string,string>
}

function money(n: number, currency = 'CAD') {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n)
}

async function sendTelegram(message: string) {
  try {
    const result = await dispatchTool('telegram_notify', { message: message.slice(0, 4000) }, { attachments: [], language: 'en' })
    return !!result?.ok
  } catch { return false }
}

async function deliver(subject: string, body: string) {
  const telegram = await sendTelegram(body)
  if (telegram) return { sent: true, channel: 'telegram' as const }
  try {
    const result = await sendEmail({ to: OWNER_EMAIL, subject, body, type: 'executive_brief' })
    return { sent: !!result.sent, channel: 'email' as const }
  } catch { return { sent: false, channel: 'none' as const } }
}

async function recentMonitorReports(hours = 24) {
  const since = new Date(Date.now() - hours * 3600000)
  const rows = await db.memory.findMany({
    where: { category: { in: ['qa_health_report', 'external_uptime_report'] }, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  return rows.flatMap(row => {
    try { return [JSON.parse(row.value)] } catch { return [] }
  })
}

async function verifiedRevenue() {
  const rows = await db.transaction.findMany({ where: { status: 'succeeded', currency: 'CAD' } })
  return rows.reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0)
}

export async function buildMorningExecutiveBrief() {
  await ensureDbReady().catch(() => {})
  const [revenue, customers, opportunities, strategies, reports] = await Promise.all([
    verifiedRevenue(),
    db.customer.count({ where: { status: { not: 'lost' } } }),
    db.opportunity.count({ where: { status: { in: ['open', 'active', 'qualified'] } } }).catch(() => 0),
    db.businessStrategy.findMany({ where: { status: { in: ['planned', 'in_progress', 'active'] } }, orderBy: { priority: 'desc' }, take: 5 }),
    recentMonitorReports(24),
  ])
  const failures = reports.reduce((n: number, r: any) => n + Number(r.failed || 0), 0)
  const critical = reports.flatMap((r: any) => r.results || []).filter((x: any) => !x.ok && x.severity === 'CRITICAL').length
  return [
    '🌅 MORNING EXECUTIVE BRIEF — CEO_AGENT007',
    `Date: ${new Date().toLocaleDateString('en-CA', { timeZone: LOCAL_TZ })}`,
    '',
    'THINK — What you should know today',
    `• Verified CAD revenue: ${money(revenue)}`,
    `• Active customers/leads: ${customers}`,
    `• Active opportunities: ${opportunities}`,
    `• Monitor failures in last 24h: ${failures}`,
    `• Critical reliability events: ${critical}`,
    '',
    'CEO PRIORITIES',
    ...(strategies.length ? strategies.map((s: any, i: number) => `${i + 1}. ${s.title} — ${s.priority} priority`) : ['1. No active strategy is currently recorded. CEO should select the highest-probability revenue mission.']),
    '',
    'CEO DECISION RULE',
    'Prioritize the next action that increases verified revenue, customer traction, reliability, or enterprise value. Do not treat projections as cash.',
    '',
    '— CEO_AGENT007 • THINK',
  ].join('\n')
}

export async function buildInvestorIntelligenceBrief() {
  await ensureDbReady().catch(() => {})
  const [revenue, customers, opportunities, strategies] = await Promise.all([
    verifiedRevenue(),
    db.customer.count({ where: { status: { not: 'lost' } } }),
    db.opportunity.count({ where: { status: { in: ['open', 'active', 'qualified'] } } }).catch(() => 0),
    db.businessStrategy.findMany({ orderBy: { updatedAt: 'desc' }, take: 5 }),
  ])
  const readiness = Math.min(100, Math.round((revenue > 0 ? 25 : 0) + (customers > 0 ? 20 : 0) + (opportunities > 0 ? 20 : 0) + (strategies.length > 0 ? 15 : 0) + 20))
  return [
    '📊 INVESTOR INTELLIGENCE BRIEF — CEO_AGENT007',
    `Week ending: ${new Date().toLocaleDateString('en-CA', { timeZone: LOCAL_TZ })}`,
    '',
    'EXECUTIVE VERDICT',
    `Investor readiness: ${readiness}/100`,
    `Verified CAD revenue: ${money(revenue)}`,
    `Customers/leads: ${customers}`,
    `Active opportunities: ${opportunities}`,
    '',
    '1. TRACTION',
    `Verified revenue is the only cash metric counted: ${money(revenue)}.`,
    `Customer base: ${customers}. Opportunity pipeline: ${opportunities}.`,
    '',
    '2. WHAT MATTERS',
    revenue > 0 ? 'Agent007 has verified transaction evidence; the next objective is repeatable acquisition and retention.' : 'Agent007 has not yet recorded verified CAD revenue; the highest-value objective remains the first verified customer payment.',
    '',
    '3. INVESTOR RISKS',
    '• Revenue concentration/scale is not yet established unless supported by verified transactions.',
    '• Pipeline and strategy records are not substitutes for customer traction.',
    '• Reliability issues must be resolved before they affect revenue execution.',
    '',
    '4. 30/60/90-DAY CEO VIEW',
    '30 days: prove repeatable customer acquisition.',
    '60 days: improve conversion, fulfillment and margin.',
    '90 days: scale the strongest validated revenue engine.',
    '',
    '5. INVESTOR QUESTIONS CEO IS PREPARED TO ANSWER',
    '• Where is verified revenue coming from?',
    '• What is repeatable?',
    '• What is the acquisition engine?',
    '• What evidence supports the growth thesis?',
    '• What could invalidate the thesis?',
    '',
    'CEO RECOMMENDATION',
    revenue > 0 ? 'BUILD TRACTION → SCALE only what is supported by verified evidence.' : 'WATCH → BUILD VERIFIED TRACTION BEFORE CLAIMING INVESTABILITY.',
    '',
    '— CEO_AGENT007 • BUILD VALUE',
  ].join('\n')
}

async function attemptCEORepair(report: any) {
  const failures = (report.results || []).filter((r: any) => !r.ok)
  const outcomes: string[] = []
  for (const failure of failures.slice(0, 10)) {
    try {
      const args = failure.name.includes('database')
        ? {}
        : failure.name.includes('system_health')
          ? { verbose: true }
          : { query: failure.actual || failure.name }
      const tool = failure.name.includes('database') ? 'database_integrity_check' : failure.name.includes('system_health') ? 'system_health_check' : 'error_log_analyzer'
      const result = await dispatchTool(tool, args, { attachments: [], language: 'en', userId: undefined, conversationId: `ceo_repair_${Date.now()}` })
      outcomes.push(`${failure.name}: ${result?.ok ? 'CEO diagnostic/recovery succeeded' : 'CEO could not resolve automatically'}`)
    } catch (e: any) {
      outcomes.push(`${failure.name}: CEO repair attempt failed — ${e?.message || 'unknown error'}`)
    }
  }
  return outcomes
}

export async function buildCEOOperationsReport() {
  await ensureDbReady().catch(() => {})
  const reports = await recentMonitorReports(24)
  const failures = reports.flatMap((r: any) => (r.results || []).filter((x: any) => !x.ok).map((x: any) => ({ ...x, monitor: r.monitor, startedAt: r.startedAt })))
  const critical = failures.filter((x: any) => x.severity === 'CRITICAL')
  const repairs: string[] = []
  for (const report of reports.filter((r: any) => Number(r.failed || 0) > 0).slice(0, 5)) repairs.push(...await attemptCEORepair(report))
  const unresolved = repairs.filter(x => x.includes('could not resolve') || x.includes('failed')).length
  return {
    critical,
    failures,
    repairs,
    unresolved,
    text: [
      '🛡️ CEO OPERATIONS REPORT — CEO_AGENT007',
      `Date: ${new Date().toLocaleDateString('en-CA', { timeZone: LOCAL_TZ })}`,
      '',
      'OPERATE — Did anything go wrong and what did the CEO do?',
      `Issues detected: ${failures.length}`,
      `CEO repair attempts: ${repairs.length}`,
      `Still unresolved: ${unresolved}`,
      `Critical incidents: ${critical.length}`,
      '',
      failures.length ? 'ISSUES' : 'SYSTEM STATUS: No monitor failures recorded in the last 24 hours.',
      ...failures.slice(0, 12).map((f: any) => `• ${f.name} — ${f.severity || 'HIGH'} — ${f.actual || 'failed'}`),
      '',
      'CEO ACTIONS',
      ...(repairs.length ? repairs.map(x => `• ${x}`) : ['• No remediation was required.']),
      '',
      critical.length ? 'IMMEDIATE ESCALATION' : 'HUMAN ESCALATION',
      ...(critical.length ? critical.slice(0, 5).map((f: any) => `• CRITICAL: ${f.name} — owner action may be required immediately.`) : unresolved ? ['• The CEO could not fully resolve one or more issues. Exact owner steps must be supplied in the next escalation artifact.'] : ['• None. CEO continues autonomous monitoring.']),
      '',
      '— CEO_AGENT007 • OPERATE',
    ].join('\n'),
  }
}

export async function sendMorningBrief() {
  const body = await buildMorningExecutiveBrief()
  return deliver('Agent007 — Morning Executive Brief', body)
}

export async function sendInvestorBrief() {
  const body = await buildInvestorIntelligenceBrief()
  return deliver('Agent007 — Investor Intelligence Brief', body)
}

export async function sendCEOOperationsReport() {
  const report = await buildCEOOperationsReport()
  const result = await deliver('Agent007 — CEO Operations Report', report.text)
  if (report.critical.length > 0) {
    await deliver('🔴 Agent007 — CRITICAL CEO ESCALATION', report.text)
  }
  return result
}
