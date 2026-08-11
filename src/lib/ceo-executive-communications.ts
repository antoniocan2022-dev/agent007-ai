import { db, ensureDbReady } from './db'
import { sendEmail } from './email'
import { OWNER_EMAIL } from './owner-config'
import { dispatchTool } from './tools'
import { getOperatorUserId } from './settings'

const LOCAL_TZ = process.env.CEO_REPORT_TIMEZONE || 'America/Toronto'
type BriefKind = 'morning' | 'operations' | 'investor'
type RevenueByCurrency = Record<string, number>

function localParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: LOCAL_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(date)
  return Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value])) as Record<string, string>
}

export function isCEOCommunicationSlot(kind: BriefKind, date = new Date()) {
  const p = localParts(date)
  const hour = Number(p.hour); const minute = Number(p.minute)
  if (kind === 'morning') return hour === 5 && minute === 0
  if (kind === 'operations') return hour === 17 && minute === 0
  return p.weekday === 'Sat' && hour === 5 && minute === 30
}

function communicationKey(kind: BriefKind, date = new Date()) {
  const p = localParts(date)
  return `ceo_communication_${kind}_${p.year}-${p.month}-${p.day}`
}

async function claimSlot(kind: BriefKind, date = new Date()) {
  const key = communicationKey(kind, date)
  try {
    await db.memory.create({ data: { key, value: new Date().toISOString(), category: 'ceo_communication_dedup' } })
    return true
  } catch { return false }
}

async function releaseSlot(kind: BriefKind, date = new Date()) {
  const key = communicationKey(kind, date)
  try {
    await db.memory.deleteMany({ where: { key, category: 'ceo_communication_dedup' } })
  } catch {
    // Best effort. If the database itself is unavailable, the next invocation
    // will still fail its claim and avoid duplicate delivery.
  }
}

/**
 * Claim the slot before work starts to prevent concurrent duplicate sends.
 * If building or delivery fails, release the claim so the next Vercel cron
 * invocation can retry. The previous implementation permanently consumed the
 * daily slot before delivery, which could silently suppress the brief after a
 * transient DB/email/Telegram failure.
 */
async function runClaimedCommunication(
  kind: BriefKind,
  subject: string,
  builder: () => Promise<string>,
) {
  if (!isCEOCommunicationSlot(kind)) return { sent: false, skipped: true, reason: `outside ${kind} local slot` }
  if (!(await claimSlot(kind))) return { sent: false, skipped: true, reason: 'already claimed for this slot' }

  try {
    const body = await builder()
    const result = await deliver(subject, body)
    if (!result.sent) await releaseSlot(kind)
    return result
  } catch (error) {
    await releaseSlot(kind)
    throw error
  }
}

function money(n: number, currency = 'CAD') {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n)
}

function formatVerifiedRevenue(revenue: RevenueByCurrency) {
  const entries = Object.entries(revenue).filter(([, amount]) => Number.isFinite(amount) && amount !== 0)
  if (!entries.length) return 'None recorded'
  return entries.map(([currency, amount]) => money(amount, currency)).join(' + ')
}

function hasVerifiedRevenue(revenue: RevenueByCurrency) {
  return Object.values(revenue).some(amount => Number.isFinite(amount) && amount > 0)
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
    orderBy: { createdAt: 'desc' }, take: 200,
  })
  return rows.flatMap(row => { try { return [JSON.parse(row.value)] } catch { return [] } })
}

async function verifiedRevenue(userId: string | null): Promise<RevenueByCurrency> {
  const rows = await db.transaction.findMany({
    where: { ...(userId ? { userId } : {}), status: 'succeeded' },
    select: { amount: true, currency: true },
  })
  return rows.reduce<RevenueByCurrency>((totals, row) => {
    const currency = String(row.currency || 'USD').toUpperCase()
    totals[currency] = (totals[currency] || 0) + Number(row.amount || 0)
    return totals
  }, {})
}

export async function buildMorningExecutiveBrief() {
  await ensureDbReady().catch(() => {})
  const userId = await getOperatorUserId()
  const [revenue, customers, opportunities, strategies, reports] = await Promise.all([
    verifiedRevenue(userId),
    db.customer.count({ where: userId ? { userId, status: { not: 'lost' } } : { status: { not: 'lost' } } }),
    db.opportunity.count({ where: userId ? { userId, status: { in: ['open', 'active', 'qualified'] } } : { status: { in: ['open', 'active', 'qualified'] } } }).catch(() => 0),
    db.businessStrategy.findMany({ where: userId ? { userId, status: { in: ['planned', 'in_progress', 'active'] } } : { status: { in: ['planned', 'in_progress', 'active'] } }, orderBy: { priority: 'desc' }, take: 5 }),
    recentMonitorReports(24),
  ])
  const failures = reports.reduce((n: number, r: any) => n + Number(r.failed || 0), 0)
  const critical = reports.flatMap((r: any) => r.results || []).filter((x: any) => !x.ok && x.severity === 'CRITICAL').length
  const priorities = strategies.length ? strategies.map((s: any, i: number) => `${i + 1}. ${s.title} — ${s.priority} priority`) : ['1. Select the highest-probability revenue mission and validate it.']
  return [
    '🌅 MORNING EXECUTIVE BRIEF — CEO_AGENT007',
    `Date: ${new Date().toLocaleDateString('en-CA', { timeZone: LOCAL_TZ })}`,
    '', 'THINK — What should I know today?',
    `• Verified revenue: ${formatVerifiedRevenue(revenue)}`,
    `• Active customers/leads: ${customers}`,
    `• Active opportunities: ${opportunities}`,
    `• Monitor failures in last 24h: ${failures}`,
    `• Critical reliability events: ${critical}`,
    '', 'CEO PRIORITIES', ...priorities,
    '', 'CEO DECISION RULE',
    'Prioritize the next action that increases verified revenue, customer traction, reliability, or enterprise value. Never treat projections as cash.',
    '', '— CEO_AGENT007 • THINK',
  ].join('\n')
}

export async function buildInvestorIntelligenceBrief() {
  await ensureDbReady().catch(() => {})
  const userId = await getOperatorUserId()
  const [revenue, customers, opportunities, strategies] = await Promise.all([
    verifiedRevenue(userId),
    db.customer.count({ where: userId ? { userId, status: { not: 'lost' } } : { status: { not: 'lost' } } }),
    db.opportunity.count({ where: userId ? { userId, status: { in: ['open', 'active', 'qualified'] } } : { status: { in: ['open', 'active', 'qualified'] } } }).catch(() => 0),
    db.businessStrategy.findMany({ where: userId ? { userId } : undefined, orderBy: { updatedAt: 'desc' }, take: 5 }),
  ])
  const verified = hasVerifiedRevenue(revenue)
  const readiness = Math.min(100, Math.round((verified ? 25 : 0) + (customers > 0 ? 20 : 0) + (opportunities > 0 ? 20 : 0) + (strategies.length > 0 ? 15 : 0) + 20))
  const revenueText = formatVerifiedRevenue(revenue)
  return [
    '📊 INVESTOR INTELLIGENCE BRIEF — CEO_AGENT007',
    `Week ending: ${new Date().toLocaleDateString('en-CA', { timeZone: LOCAL_TZ })}`,
    '', 'EXECUTIVE VERDICT',
    `Investor readiness: ${readiness}/100`,
    `Verified revenue: ${revenueText}`,
    `Customers/leads: ${customers}`,
    `Active opportunities: ${opportunities}`,
    '', '1. TRACTION',
    `Verified revenue is the only cash metric counted: ${revenueText}.`,
    `Customer base: ${customers}. Opportunity pipeline: ${opportunities}.`,
    '', '2. WHAT MATTERS',
    verified ? 'Verified transaction evidence exists; the next objective is repeatable acquisition and retention.' : 'No verified revenue is recorded yet; the highest-value objective remains the first verified customer payment.',
    '', '3. INVESTOR RISKS',
    '• Pipeline and strategy records are not substitutes for customer traction.',
    '• Reliability issues must be resolved before they affect revenue execution.',
    '• Scale claims must be supported by verified transaction evidence.',
    '', '4. 30/60/90-DAY CEO VIEW',
    '30 days: prove repeatable customer acquisition.',
    '60 days: improve conversion, fulfillment and margin.',
    '90 days: scale the strongest validated revenue engine.',
    '', '5. INVESTOR QUESTIONS CEO IS PREPARED TO ANSWER',
    '• Where is verified revenue coming from?', '• What is repeatable?',
    '• What is the acquisition engine?', '• What evidence supports the growth thesis?',
    '• What could invalidate the thesis?', '', 'CEO RECOMMENDATION',
    verified ? 'BUILD TRACTION → scale only what verified evidence supports.' : 'WATCH → build verified traction before claiming investability.',
    '', '— CEO_AGENT007 • BUILD VALUE',
  ].join('\n')
}

async function attemptCEORepair(report: any) {
  const failures = (report.results || []).filter((r: any) => !r.ok)
  const outcomes: string[] = []
  for (const failure of failures.slice(0, 10)) {
    try {
      const args = failure.name.includes('database') ? { fix: true } : failure.name.includes('system_health') ? { verbose: true } : { query: failure.actual || failure.name }
      const tool = failure.name.includes('database') ? 'database_integrity_check' : failure.name.includes('system_health') ? 'system_health_check' : 'error_log_analyzer'
      const result = await dispatchTool(tool, args, { attachments: [], language: 'en', conversationId: `ceo_repair_${Date.now()}` })
      outcomes.push(`${failure.name}: ${result?.ok ? 'CEO remediation/diagnostic succeeded' : 'CEO could not resolve automatically'}`)
    } catch (e: any) { outcomes.push(`${failure.name}: CEO repair attempt failed — ${e?.message || 'unknown error'}`) }
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
  const ownerSteps = unresolved ? [
    '1. Open CEO_AGENT007 → System → QA Monitor.',
    '2. Open the unresolved check and review the exact failure.',
    '3. Follow the CEO diagnostic/fix recommendation.',
    '4. Re-run the affected QA check and confirm ok=true.',
    '5. If still failing, send the CEO the exact result for a second repair cycle.',
  ] : []
  const issueLines = failures.length ? ['ISSUES', ...failures.slice(0, 12).map((f: any) => `• ${f.name} — ${f.severity || 'HIGH'} — ${f.actual || 'failed'}`)] : ['SYSTEM STATUS: No monitor failures recorded in the last 24 hours.']
  const actionLines = repairs.length ? repairs.map(x => `• ${x}`) : ['• No remediation was required.']
  const escalationLines = unresolved ? ['HUMAN ACTION REQUIRED', ...ownerSteps] : critical.length ? ['HUMAN ESCALATION', ...critical.slice(0, 5).map((f: any) => `• CRITICAL: ${f.name} — immediate owner attention may be required.`)] : ['HUMAN ESCALATION', '• None. CEO continues autonomous monitoring.']
  const text = ['🛡️ CEO OPERATIONS REPORT — CEO_AGENT007', `Date: ${new Date().toLocaleDateString('en-CA', { timeZone: LOCAL_TZ })}`, '', 'OPERATE — Did anything go wrong and what did the CEO do?', `Issues detected: ${failures.length}`, `CEO repair attempts: ${repairs.length}`, `Still unresolved: ${unresolved}`, `Critical incidents: ${critical.length}`, '', ...issueLines, '', 'CEO ACTIONS', ...actionLines, '', ...escalationLines, '', '— CEO_AGENT007 • OPERATE'].join('\n')
  return { critical, failures, repairs, unresolved, text }
}

export async function sendCriticalCEOEscalation(report: any) {
  const critical = (report?.results || []).filter((r: any) => !r.ok && r.severity === 'CRITICAL')
  if (!critical.length) return { sent: false, reason: 'no critical incident' }
  const repairs = await attemptCEORepair(report)
  const unresolved = repairs.some(x => x.includes('could not resolve') || x.includes('failed'))
  if (!unresolved) return { sent: false, reason: 'CEO resolved critical incident' }
  const body = ['🔴 CEO_AGENT007 — CRITICAL ESCALATION', `Time: ${new Date().toLocaleString('en-CA', { timeZone: LOCAL_TZ })}`, '', `Critical issues: ${critical.length}`, ...critical.slice(0, 5).map((f: any) => `• ${f.name}: ${f.actual || 'failed'}`), '', 'CEO ATTEMPTS', ...repairs.map(x => `• ${x}`), '', 'OWNER ACTION', '1. Open CEO_AGENT007 → System → QA Monitor.', '2. Open the unresolved critical check.', '3. Follow the CEO diagnostic/fix instructions.', '4. Re-run the check and confirm ok=true.', '', 'The CEO will continue monitoring after your intervention.'].join('\n')
  return deliver('🔴 Agent007 — Critical CEO Escalation', body)
}

export async function sendMorningBrief() {
  return runClaimedCommunication('morning', 'Agent007 — Morning Executive Brief', buildMorningExecutiveBrief)
}

export async function sendInvestorBrief() {
  return runClaimedCommunication('investor', 'Agent007 — Investor Intelligence Brief', buildInvestorIntelligenceBrief)
}

export async function sendCEOOperationsReport() {
  return runClaimedCommunication('operations', 'Agent007 — CEO Operations Report', async () => (await buildCEOOperationsReport()).text)
}
