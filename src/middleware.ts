import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'
import { checkRateLimit, getClientIP, isAuthenticatedRequest } from './lib/rate-limiter'

// UPGRADE #96 — Rate limiting wrapper (authenticated users exempt)
// UPGRADE #97c FIX — Exempt auth-protected routes from rate limiting.
// The rate limiter runs BEFORE withAuth, so it can't detect session cookies
// reliably. Auth-protected routes (agent, conversations, memory, etc.) should
// NOT be rate-limited because they require authentication anyway.
const RATE_LIMIT_EXEMPT = [
  '/api/agent',
  '/api/conversations',
  '/api/memory',
  '/api/settings',
  '/api/income',
  '/api/transactions',
  '/api/users',
  '/api/upload',
  '/api/file',
  '/api/auth',
  '/api/2fa',
  '/api/webhooks',
]

const withRateLimit = (handler: any) => {
  return async (req: any) => {
    const pathname = req.nextUrl?.pathname || ''
    if (pathname.startsWith('/api/')) {
      // Skip rate limiting for auth-protected routes (they have their own auth)
      const isExempt = RATE_LIMIT_EXEMPT.some(p => pathname.startsWith(p))
      if (!isExempt) {
        const ip = getClientIP(req)
        if (!isAuthenticatedRequest(req)) {
          const result = checkRateLimit(ip, pathname)
          if (result.limited) {
            return NextResponse.json(
              { ok: false, error: 'Rate limit exceeded', retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000) },
              { status: 429, headers: { 'Retry-After': String(Math.ceil((result.resetAt - Date.now()) / 1000)) } }
            )
          }
        }
      }
    }
    return handler(req)
  }
}

/**
 * Auth middleware protecting sensitive API routes.
 *
 * UPGRADE #59 (2026-07-12) — OWNER-ONLY BACKUP DOWNLOAD
 *
 * Reverts the previous public access to /api/backup. The owner complained
 * that "only the owner me can download it" — so backup downloads are now
 * secured via a new /api/owner-backup endpoint that requires a token.
 *
 * NEW: /api/owner-backup?token=<OWNER_BACKUP_TOKEN>&format=json|zip
 *   - Token-based auth (no login required, but token is required)
 *   - Token = OWNER_BACKUP_TOKEN env var (or hardcoded fallback)
 *   - Only the owner knows the token → only the owner can download
 *
 * EXCEPTIONS (accessible without login):
 *   - /api/auth/*                  — NextAuth routes
 *   - /api/webhooks/*              — Stripe, PayPal webhooks
 *   - /api/2fa/*                   — 2FA challenge/verify (needed before login)
 *   - /api/health                  — public health check (referenced by External Monitor)
 *   - /api/health/*                — sub-health endpoints (e.g. /api/health/llm)
 *   - /api/init                    — initialization
 *   - /api/owner-auth/*            — owner auth flow
 *   - /api/owner-backup            — NEW: owner-only backup download (token auth)
 *   - /api/system/manifest         — public upgrade manifest
 *   - /api/system/capabilities     — public capabilities listing
 *   - /api/system/capabilities-download — public ZIP download (capabilities, NOT backup)
 *   - /api/system/audit            — public audit endpoint
 *   - /api/system/self-heal        — public self-heal trigger
 *   - /api/system/refresh          — public refresh
 *   - /api/system/reload           — public reload
 *   - /api/system/seed-agents      — public seeding (idempotent)
 *   - /api/system/clear-cache      — public cache clear
 *   - /api/system/diagnose-email   — public diagnostics
 *   - /api/system/diagnose-llm     — public diagnostics
 *   - /api/system/fix-hydration    — public ops
 *   - /api/system/test-communication — public ops
 *   - /api/system/zip-backup       — public ZIP backup LISTING (metadata only, no actual data)
 *   - /api/system/self-restore     — NEW: owner-only restore from backup (token auth, same as /api/owner-backup)
 *   - /api/commands/inbound        — webhook from email/SMS
 *   - /api/schedules/tick          — Vercel Cron (daily 09:00 UTC)
 *   - /api/monitor/*               — Vercel Cron monitors (QA hourly + External every 30 min)
 *   - /api/subagents               — public subagent listing (read-only; needed by External Monitor)
 *
 * Routes that REQUIRE auth (session OR token):
 *   - /api/backup                  — REVERTED to session-required (owner-only via login)
 *   - /api/system/backup-download  — REVERTED to session-required (use /api/owner-backup for token access)
 *   - /api/system/load-backup      — REVERTED to session-required
 *   - /api/agent                   — dispatch the super agent (costs LLM tokens)
 *   - /api/conversations           — user's private conversations
 *   - /api/conversations/[id]      — single conversation
 *   - /api/memory                  — user's private memory
 *   - /api/upload                  — file upload (uses user's storage)
 *   - /api/file                    — file download
 *   - /api/settings                — user's settings
 *   - /api/users                   — user management
 *   - /api/income, /api/transactions, etc. — financial data
 *   - All other sensitive routes
 */
export default withRateLimit(withAuth({
  pages: {
    signIn: '/login',
  },
}))

export const config = {
  matcher: [
    '/api/((?!auth|webhooks|2fa|health|health/diagnostics|init|warm|owner-auth|owner-backup|backup/download|backup/download-source|checkout|file-download|download-link|admin/reissue|system/manifest|system/capabilities|system/capabilities-download|system/audit|system/self-heal|system/refresh|system/reload|system/seed-agents|system/clear-cache|system/diagnose-email|system/diagnose-llm|system/fix-hydration|system/fix-agents|system/test-communication|system/capability-audit|system/team-performance|system/zip-backup|system/self-restore|system/morning-brief|system/world-model|system/telemetry|system/observability|system/audit-engine|system/lifecycle|system/self-healing|system/evolution|system/improvement|system/constitution|system/simulate|system/adaptive-weights|system/live-monitor|system/org-policies|system/org-knowledge|system/portfolio|system/flywheel|system/dual-missions|version|system/debate|system/mission|commands/inbound|schedules/tick|schedules/morning-brief|monitor|subagents|mission-active|mission/tick|recipes|triggers|decisions|reality-check|tools/test|tools/health|tools/benchmark|tools/analytics|tools/coordination|tools/integration-test|tools/self-heal|tools/repair|team).*)',
  ],
}
