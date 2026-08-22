import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'
import { checkRateLimit, getClientIP, isAuthenticatedRequest } from './lib/rate-limiter'

const RATE_LIMIT_EXEMPT = [
  '/api/agent', '/api/conversations', '/api/memory', '/api/settings',
  '/api/income', '/api/transactions', '/api/users', '/api/upload', '/api/file',
  '/api/auth', '/api/2fa', '/api/webhooks',
]

const withRateLimit = (handler: any) => async (req: any) => {
  const pathname = req.nextUrl?.pathname || ''
  if (pathname.startsWith('/api/')) {
    const isExempt = RATE_LIMIT_EXEMPT.some(p => pathname.startsWith(p))
    if (!isExempt) {
      const ip = getClientIP(req)
      if (!isAuthenticatedRequest(req)) {
        const result = checkRateLimit(ip, pathname)
        if (result.limited) {
          return NextResponse.json(
            { ok: false, error: 'Rate limit exceeded', retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000) },
            { status: 429, headers: { 'Retry-After': String(Math.ceil((result.resetAt - Date.now()) / 1000)) } },
          )
        }
      }
    }
  }
  return handler(req)
}

/**
 * Next.js 16 Proxy protecting sensitive API routes.
 * Public operational exceptions perform their own authorization in-route.
 */
export default withRateLimit(withAuth({ pages: { signIn: '/login' } }))

export const config = {
  matcher: [
    '/api/((?!auth|webhooks|2fa|health|release-health|health/diagnostics|init|warm|owner-auth|owner-backup|backup/download|backup/download-source|checkout|file-download|download-link|admin/reissue|system/manifest|system/capabilities|system/capabilities-download|system/audit|system/self-heal|system/refresh|system/reload|system/seed-agents|system/clear-cache|system/diagnose-email|system/diagnose-llm|system/diagnose-providers|system/diagnose-huggingface|system/fix-hydration|system/fix-agents|system/test-communication|system/capability-audit|system/team-performance|system/zip-backup|system/self-restore|system/morning-brief|system/world-model|system/telemetry|system/observability|system/audit-engine|system/lifecycle|system/self-healing|system/evolution|system/improvement|system/constitution|system/simulate|system/adaptive-weights|system/live-monitor|system/org-policies|system/org-knowledge|system/portfolio|system/flywheel|system/dual-missions|system/goals|system/portfolio-health|system/cross-insights|system/vid-kpis|system/vid-backup|system/version|system/debate|system/mission|commands/inbound|schedules/tick|schedules/morning-brief|schedules/ceo-morning-brief|schedules/ceo-operations-report|monitor|subagents|mission-active|mission/tick|recipes|triggers|decisions|reality-check|tools/test|tools/health|tools/benchmark|tools/analytics|tools/coordination|tools/integration-test|tools/self-heal|tools/repair|team).*)',
  ],
}
