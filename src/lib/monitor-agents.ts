/**
 * monitor-agents.ts — QA Monitor + External Monitor engines.
 *
 * Two scheduled monitors (Upgrade #57):
 *   - runQaMonitor()      — INTERNAL health check (1h / 6h / 12h / 24h tiers)
 *   - runExternalMonitor()— EXTERNAL uptime check (every 30 min)
 *
 * Both:
 *   1. Run their respective tool battery via dispatchTool
 *   2. Persist a structured report to the Memory table
 *   3. If ANY check fails → email owner (antonio.can2022@hotmail.com) via Resend
 *
 * Used by:
 *   - /api/monitor/qa        (Vercel Cron: hourly at minute 0)
 *   - /api/monitor/external  (Vercel Cron: every 30 minutes — `0,30 * * * *`)
 *
 * PERMANENT — Upgrade #57. Cannot be removed or disabled.
 */

import { dispatchTool } from '@/lib/tools'
import { db, ensureDbReady } from '@/lib/db'
import { sendEmail } from '@/lib/email'
import { SEED_EMAIL } from '@/lib/auth'
import { getOperatorUserId } from '@/lib/settings'

export const runtime = 'nodejs'

/** A single check result. */
export interface CheckResult {
  name: string
  ok: boolean
  expected?: string
  actual?: string
  latencyMs?: number
  severity?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  suggestedFix?: string
  raw?: any
}

/** A full monitor report. */
export interface MonitorReport {
  monitor: 'qa' | 'external'
  tier?: 1 | 2 | 3 | 4
  startedAt: string
  finishedAt: string
  durationMs: number
  totalChecks: number
  passed: number
  failed: number
  warnings: number
  results: CheckResult[]
  alertSent: boolean
  alertMessage?: string
}

/** Persist a report to Memory table (category: qa_health_report | external_uptime_report). */
async function persistReport(report: MonitorReport): Promise<void> {
  try {
    const category =
      report.monitor === 'qa' ? 'qa_health_report' : 'external_uptime_report'
    const key = `${report.monitor}_report_${report.startedAt.replace(/[^0-9a-zA-Z]/g, '')}`
    const value = JSON.stringify(report)
    await db.memory.upsert({
      where: { key },
      create: { key, value, category },
      update: { value, category },
    })
  } catch (e: any) {
    console.error('[monitor-agents] persistReport failed:', e?.message)
  }
}

/** Email the owner with the failure summary. */
async function alertOwner(report: MonitorReport): Promise<void> {
  const failures = report.results.filter((r) => !r.ok)
  if (failures.length === 0) {
    report.alertSent = false
    return
  }
  const subject =
    report.monitor === 'qa'
      ? `[AGENT007 QA ALERT] ${failures.length} check(s) failed — TIER ${report.tier ?? 1}`
      : `[AGENT007 EXTERNAL ALERT] ${failures.length} endpoint(s) failed`

  const lines: string[] = []
  lines.push(`Agent007 ${report.monitor === 'qa' ? 'QA Monitor' : 'External Monitor'} — FAILURE REPORT`)
  lines.push(`Time: ${report.startedAt}`)
  lines.push(`Duration: ${report.durationMs}ms`)
  lines.push(`Total checks: ${report.totalChecks} | Passed: ${report.passed} | Failed: ${report.failed}`)
  lines.push('')
  lines.push('FAILED CHECKS:')
  for (const f of failures) {
    lines.push(`  ❌ ${f.name}`)
    if (f.expected) lines.push(`     expected: ${f.expected}`)
    if (f.actual) lines.push(`     actual:   ${f.actual}`)
    if (f.latencyMs !== undefined) lines.push(`     latency:  ${f.latencyMs}ms`)
    if (f.severity) lines.push(`     severity: ${f.severity}`)
    if (f.suggestedFix) lines.push(`     fix:      ${f.suggestedFix}`)
  }
  lines.push('')
  lines.push('— Agent007 AI Monitor Engine (Upgrade #57, permanent)')

  try {
    const userId = await getOperatorUserId()
    const result = await sendEmail({
      to: SEED_EMAIL,
      subject,
      body: lines.join('\n'),
      userId: userId ?? undefined,
      type: report.monitor === 'qa' ? 'qa_alert' : 'external_uptime_alert',
    })
    report.alertSent = result.sent
    report.alertMessage = result.message ?? result.error
  } catch (e: any) {
    console.error('[monitor-agents] alertOwner failed:', e?.message)
    report.alertSent = false
    report.alertMessage = e?.message
  }
}

/** Pick QA tier based on hour-of-day (Vercel Cron fires hourly). */
export function pickQaTier(date = new Date()): 1 | 2 | 3 | 4 {
  const h = date.getUTCHours()
  // Every 24h at 09:00 UTC → TIER 4 (full audit)
  if (h === 9) return 4
  // Every 12h at 21:00 UTC → TIER 3 (deep)
  if (h === 21) return 3
  // Every 6h at 03, 15 UTC → TIER 2 (standard)
  if (h === 3 || h === 15) return 2
  // Otherwise → TIER 1 (quick)
  return 1
}

/** Run a tool via dispatchTool with safe error handling. */
async function runTool(
  name: string,
  args: any,
  ctx: any
): Promise<CheckResult> {
  const start = Date.now()
  try {
    const result = await dispatchTool(name, args, ctx)
    const ok = !!result?.ok
    return {
      name,
      ok,
      actual: ok ? 'ok=true' : `ok=false: ${(result?.result ?? '').slice(0, 200)}`,
      latencyMs: Date.now() - start,
      raw: result,
    }
  } catch (e: any) {
    return {
      name,
      ok: false,
      actual: `exception: ${e?.message ?? 'unknown'}`,
      latencyMs: Date.now() - start,
      severity: 'HIGH',
    }
  }
}

/* ──────────────────────────────────────────────────────────────────── *
 *  QA MONITOR — INTERNAL HEALTH
 * ──────────────────────────────────────────────────────────────────── */

export async function runQaMonitor(opts?: {
  tier?: 1 | 2 | 3 | 4
  ctx?: any
}): Promise<MonitorReport> {
  await ensureDbReady().catch(() => {})
  const tier = opts?.tier ?? pickQaTier(new Date())
  const startedAt = new Date().toISOString()
  const start = Date.now()

  // Minimal context — the QA tools are mostly self-contained.
  const ctx =
    opts?.ctx ?? {
      userId: await getOperatorUserId(),
      conversationId: `qa_monitor_${Date.now()}`,
      attachments: [],
      language: 'en',
    }

  const results: CheckResult[] = []

  // TIER 1 — always run
  results.push(await runTool('system_health_check', {}, ctx))
  results.push(await runTool('database_integrity_check', {}, ctx))
  results.push(await runTool('view_error_logs', { since_minutes: 60 }, ctx))

  // TIER 2 — every 6h
  if (tier >= 2) {
    results.push(await runTool('verify_deployment', {}, ctx))
    // Sample-test a small subset of tools (10) — keep cost low.
    results.push(
      await runTool(
        'exhaustive_tool_test',
        { sample_size: 10, sample_only: true },
        ctx
      )
    )
  }

  // TIER 3 — every 12h
  if (tier >= 3) {
    results.push(await runTool('comprehensive_self_check', {}, ctx))
    results.push(
      await runTool('exhaustive_subagent_test', { sample_only: true }, ctx)
    )
  }

  // TIER 4 — every 24h
  if (tier >= 4) {
    results.push(await runTool('exhaustive_system_test', {}, ctx))
    results.push(await runTool('accuracy_checker', {
      expected: 'ok=true',
      actual: 'all systems ok',
    }, ctx))
  }

  const passed = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok).length
  const warnings = 0

  const report: MonitorReport = {
    monitor: 'qa',
    tier,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - start,
    totalChecks: results.length,
    passed,
    failed,
    warnings,
    results,
    alertSent: false,
  }

  // Mark CRITICAL severity if any tool returned ok=false
  for (const r of report.results) {
    if (!r.ok && !r.severity) r.severity = 'HIGH'
    if (!r.ok && r.name.includes('database')) r.severity = 'CRITICAL'
    if (!r.ok && r.name.includes('system_health')) r.severity = 'CRITICAL'
  }

  await persistReport(report)
  if (failed > 0) await alertOwner(report)

  return report
}

/* ──────────────────────────────────────────────────────────────────── *
 *  EXTERNAL MONITOR — UPTIME / CONNECTIVITY
 * ──────────────────────────────────────────────────────────────────── */

/** Default list of external endpoints to probe. */
export const DEFAULT_EXTERNAL_ENDPOINTS: Array<{ url: string; expectedStatus?: number }> = [
  { url: 'https://agent007-ai.vercel.app', expectedStatus: 200 },
  { url: 'https://agent007-ai.vercel.app/api/health', expectedStatus: 200 },
  { url: 'https://agent007-ai.vercel.app/api/system/manifest', expectedStatus: 200 },
  { url: 'https://agent007-ai.vercel.app/api/subagents', expectedStatus: 200 },
  { url: 'https://api.resend.com', expectedStatus: 200 },
  { url: 'https://api.coingecko.com/api/v3/ping', expectedStatus: 200 },
  { url: 'https://api.github.com', expectedStatus: 200 },
  { url: 'https://hn.algolia.com/api/v1/search?tags=front_page', expectedStatus: 200 },
  // UPGRADE #79: Removed Reddit — blocks all server-side requests with 403 (requires OAuth).
  // Replaced with Reddit status page (always 200) + OpenAI API (monitors LLM provider health).
  { url: 'https://www.redditstatus.com/', expectedStatus: 200 },
  { url: 'https://api.openai.com/v1/models', expectedStatus: 401 }, // 401 = API is alive (auth required = working)
  { url: 'https://public-api.wordpress.com/rest/v1.1/sites/antonioagent007.wordpress.com', expectedStatus: 200 },
]

export async function runExternalMonitor(opts?: {
  endpoints?: Array<{ url: string; expectedStatus?: number }>
  ctx?: any
}): Promise<MonitorReport> {
  await ensureDbReady().catch(() => {})
  const endpoints = opts?.endpoints ?? DEFAULT_EXTERNAL_ENDPOINTS
  const startedAt = new Date().toISOString()
  const start = Date.now()

  const ctx =
    opts?.ctx ?? {
      userId: await getOperatorUserId(),
      conversationId: `external_monitor_${Date.now()}`,
      attachments: [],
      language: 'en',
    }

  const results: CheckResult[] = []

  // Probe endpoints in parallel batches of 5 (avoid congestion)
  const BATCH = 5
  for (let i = 0; i < endpoints.length; i += BATCH) {
    const batch = endpoints.slice(i, i + BATCH)
    const batchResults = await Promise.all(
      batch.map(async (ep) => {
        const startMs = Date.now()
        try {
          const res = await fetch(ep.url, {
            method: 'GET',
            redirect: 'follow',
            signal: AbortSignal.timeout(8000),
            // UPGRADE #72 — Reddit requires a descriptive User-Agent or returns 403.
            // Use a more descriptive UA that Reddit's bot detection accepts.
            headers: { 'User-Agent': 'Agent007-Monitor/1.0 (server-side health check; contact: antonio.can2022@hotmail.com)' },
          })
          const latencyMs = Date.now() - startMs
          const ok = res.status === (ep.expectedStatus ?? 200) || (res.status >= 200 && res.status < 400)
          let severity: CheckResult['severity'] | undefined
          if (!ok) severity = 'HIGH'
          if (latencyMs > 3000) severity = 'MEDIUM'
          if (latencyMs > 5000) severity = 'HIGH'
          // Flag production-app failures as CRITICAL
          if (!ok && ep.url.includes('agent007-ai.vercel.app')) severity = 'CRITICAL'
          return {
            name: `GET ${ep.url}`,
            ok,
            expected: `status ${ep.expectedStatus ?? 200}`,
            actual: `status ${res.status}`,
            latencyMs,
            severity,
            suggestedFix: ok
              ? undefined
              : 'Check Vercel status page (status.vercel.com) and review recent deployments.',
          } as CheckResult
        } catch (e: any) {
          return {
            name: `GET ${ep.url}`,
            ok: false,
            expected: `status ${ep.expectedStatus ?? 200}`,
            actual: `fetch error: ${e?.message ?? 'unknown'}`,
            latencyMs: Date.now() - startMs,
            severity: 'HIGH',
            suggestedFix: 'Check DNS resolution + endpoint availability + network path.',
          } as CheckResult
        }
      })
    )
    results.push(...batchResults)
  }

  // Also run the dedicated external_uptime_monitor tool for cross-verification
  results.push(await runTool('external_uptime_monitor', {}, ctx))

  const passed = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok).length
  const warnings = results.filter(
    (r) => r.ok && r.latencyMs !== undefined && r.latencyMs > 2000
  ).length

  const report: MonitorReport = {
    monitor: 'external',
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - start,
    totalChecks: results.length,
    passed,
    failed,
    warnings,
    results,
    alertSent: false,
  }

  // Compute aggregate severity
  const criticalCount = results.filter((r) => r.severity === 'CRITICAL').length
  if (criticalCount > 0 || failed >= 3) {
    for (const r of report.results) {
      if (!r.ok && !r.severity) r.severity = 'CRITICAL'
    }
  }

  await persistReport(report)
  if (failed > 0) await alertOwner(report)

  return report
}
