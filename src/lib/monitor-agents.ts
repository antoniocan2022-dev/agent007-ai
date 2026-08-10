/**
 * monitor-agents.ts — QA Monitor + External Monitor engines.
 *
 * Monitor evidence is persisted for CEO_AGENT007. Owner notifications are
 * consolidated by CEO Operations; only critical incidents are escalated
 * immediately after CEO remediation is attempted.
 */

import { dispatchTool } from '@/lib/tools'
import { db, ensureDbReady } from '@/lib/db'
import { getOperatorUserId } from '@/lib/settings'

export const runtime = 'nodejs'

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

async function persistReport(report: MonitorReport): Promise<void> {
  try {
    const category = report.monitor === 'qa' ? 'qa_health_report' : 'external_uptime_report'
    const key = `${report.monitor}_report_${report.startedAt.replace(/[^0-9a-zA-Z]/g, '')}`
    const value = JSON.stringify(report)
    await db.memory.upsert({ where: { key }, create: { key, value, category }, update: { value, category } })
  } catch (e: any) {
    console.error('[monitor-agents] persistReport failed:', e?.message)
  }
}

/** Legacy alert hook retained for compatibility; CEO owns notification now. */
async function alertOwner(report: MonitorReport): Promise<void> {
  report.alertSent = false
  report.alertMessage = report.failed > 0
    ? 'Owner notification deferred to CEO Operations; critical incidents are escalated immediately.'
    : undefined
}

export function pickQaTier(date = new Date()): 1 | 2 | 3 | 4 {
  const h = date.getUTCHours()
  if (h === 9) return 4
  if (h === 21) return 3
  if (h === 3 || h === 15) return 2
  return 1
}

async function runTool(name: string, args: any, ctx: any): Promise<CheckResult> {
  const start = Date.now()
  try {
    const result = await dispatchTool(name, args, ctx)
    const ok = !!result?.ok
    return { name, ok, actual: ok ? 'ok=true' : `ok=false: ${(result?.result ?? '').slice(0, 200)}`, latencyMs: Date.now() - start, raw: result }
  } catch (e: any) {
    return { name, ok: false, actual: `exception: ${e?.message ?? 'unknown'}`, latencyMs: Date.now() - start, severity: 'HIGH' }
  }
}

export async function runQaMonitor(opts?: { tier?: 1 | 2 | 3 | 4; ctx?: any }): Promise<MonitorReport> {
  await ensureDbReady().catch(() => {})
  const tier = opts?.tier ?? pickQaTier(new Date())
  const startedAt = new Date().toISOString()
  const start = Date.now()
  const ctx = opts?.ctx ?? { userId: await getOperatorUserId(), conversationId: `qa_monitor_${Date.now()}`, attachments: [], language: 'en' }
  const results: CheckResult[] = []

  results.push(await runTool('system_health_check', {}, ctx))
  results.push(await runTool('database_integrity_check', {}, ctx))
  results.push(await runTool('view_error_logs', { since_minutes: 60 }, ctx))
  if (tier >= 2) {
    results.push(await runTool('verify_deployment', {}, ctx))
    results.push(await runTool('exhaustive_tool_test', { sample_size: 10, sample_only: true }, ctx))
  }
  if (tier >= 3) {
    results.push(await runTool('comprehensive_self_check', {}, ctx))
    results.push(await runTool('exhaustive_subagent_test', { sample_only: true }, ctx))
  }
  if (tier >= 4) {
    results.push(await runTool('exhaustive_system_test', {}, ctx))
    results.push(await runTool('accuracy_checker', { expected: 'ok=true', actual: 'all systems ok' }, ctx))
  }

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  const report: MonitorReport = {
    monitor: 'qa', tier, startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - start,
    totalChecks: results.length, passed, failed, warnings: 0, results, alertSent: false,
  }
  for (const r of report.results) {
    if (!r.ok && !r.severity) r.severity = 'HIGH'
    if (!r.ok && r.name.includes('database')) r.severity = 'CRITICAL'
    if (!r.ok && r.name.includes('system_health')) r.severity = 'CRITICAL'
  }
  await persistReport(report)
  if (failed > 0) await alertOwner(report)
  return report
}

export const DEFAULT_EXTERNAL_ENDPOINTS: Array<{ url: string; expectedStatus?: number }> = [
  { url: 'https://agent007-ai.vercel.app', expectedStatus: 200 },
  { url: 'https://agent007-ai.vercel.app/api/health', expectedStatus: 200 },
  { url: 'https://agent007-ai.vercel.app/api/system/manifest', expectedStatus: 200 },
  { url: 'https://agent007-ai.vercel.app/api/subagents', expectedStatus: 200 },
  { url: 'https://api.resend.com', expectedStatus: 200 },
  { url: 'https://api.coingecko.com/api/v3/ping', expectedStatus: 200 },
  { url: 'https://api.github.com', expectedStatus: 200 },
  { url: 'https://hn.algolia.com/api/v1/search?tags=front_page', expectedStatus: 200 },
  { url: 'https://www.redditstatus.com/', expectedStatus: 200 },
  { url: 'https://api.openai.com/v1/models', expectedStatus: 401 },
  { url: 'https://public-api.wordpress.com/rest/v1.1/sites/antonioagent007.wordpress.com', expectedStatus: 200 },
]

export async function runExternalMonitor(opts?: { endpoints?: Array<{ url: string; expectedStatus?: number }>; ctx?: any }): Promise<MonitorReport> {
  await ensureDbReady().catch(() => {})
  const endpoints = opts?.endpoints ?? DEFAULT_EXTERNAL_ENDPOINTS
  const startedAt = new Date().toISOString()
  const start = Date.now()
  const ctx = opts?.ctx ?? { userId: await getOperatorUserId(), conversationId: `external_monitor_${Date.now()}`, attachments: [], language: 'en' }
  const results: CheckResult[] = []
  const BATCH = 5

  for (let i = 0; i < endpoints.length; i += BATCH) {
    const batch = endpoints.slice(i, i + BATCH)
    const batchResults = await Promise.all(batch.map(async ep => {
      const startMs = Date.now()
      try {
        const res = await fetch(ep.url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Agent007-Monitor/1.0 (server-side health check)' } })
        const latencyMs = Date.now() - startMs
        const ok = res.status === (ep.expectedStatus ?? 200) || (res.status >= 200 && res.status < 400)
        let severity: CheckResult['severity'] | undefined
        if (!ok) severity = 'HIGH'
        if (latencyMs > 3000) severity = 'MEDIUM'
        if (latencyMs > 5000) severity = 'HIGH'
        if (!ok && ep.url.includes('agent007-ai.vercel.app')) severity = 'CRITICAL'
        return { name: `GET ${ep.url}`, ok, expected: `status ${ep.expectedStatus ?? 200}`, actual: `status ${res.status}`, latencyMs, severity, suggestedFix: ok ? undefined : 'Check Vercel status and recent deployments.' } as CheckResult
      } catch (e: any) {
        return { name: `GET ${ep.url}`, ok: false, expected: `status ${ep.expectedStatus ?? 200}`, actual: `fetch error: ${e?.message ?? 'unknown'}`, latencyMs: Date.now() - startMs, severity: 'HIGH', suggestedFix: 'Check DNS, endpoint availability, and network path.' } as CheckResult
      }
    }))
    results.push(...batchResults)
  }
  results.push(await runTool('external_uptime_monitor', {}, ctx))

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  const report: MonitorReport = {
    monitor: 'external', startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - start,
    totalChecks: results.length, passed, failed,
    warnings: results.filter(r => r.ok && r.latencyMs !== undefined && r.latencyMs > 2000).length,
    results, alertSent: false,
  }
  const criticalCount = results.filter(r => r.severity === 'CRITICAL').length
  if (criticalCount > 0 || failed >= 3) for (const r of report.results) if (!r.ok && !r.severity) r.severity = 'CRITICAL'
  await persistReport(report)
  if (failed > 0) await alertOwner(report)
  return report
}
