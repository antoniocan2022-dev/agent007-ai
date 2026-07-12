import { withAuth } from 'next-auth/middleware'

/**
 * Auth middleware protecting sensitive API routes.
 *
 * UPGRADE #58 (2026-07-12) — EXPANDED WHITELIST
 *
 * Previously: Vercel Cron monitors (/api/monitor/*), the subagents list, the
 * backup download, and the health endpoint were all blocked by auth → 307
 * redirect to /login. This caused:
 *   - Vercel Cron jobs to fail (no session cookie)
 *   - Owner "I can't download the JSON" complaint
 *   - External tooling to be unable to query subagent list
 *   - External Monitor to false-positive report /api/health as down
 *
 * EXCEPTIONS (accessible without login):
 *   - /api/auth/*                  — NextAuth routes
 *   - /api/webhooks/*              — Stripe, PayPal webhooks
 *   - /api/2fa/*                   — 2FA challenge/verify (needed before login)
 *   - /api/health                  — public health check (referenced by External Monitor)
 *   - /api/health/*                — sub-health endpoints (e.g. /api/health/llm)
 *   - /api/init                    — initialization
 *   - /api/owner-auth/*            — owner auth flow
 *   - /api/system/manifest         — public upgrade manifest
 *   - /api/system/capabilities     — public capabilities listing
 *   - /api/system/capabilities-download — public ZIP download
 *   - /api/system/backup-download  — public on-demand backup (regenerates per request)
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
 *   - /api/system/zip-backup       — public ZIP backup listing
 *   - /api/system/load-backup      — public backup loader
 *   - /api/commands/inbound        — webhook from email/SMS
 *   - /api/schedules/tick          — Vercel Cron (daily 09:00 UTC)
 *   - /api/monitor/*               — Vercel Cron monitors (QA hourly + External every 30 min)
 *   - /api/subagents               — public subagent listing (read-only; mutations still need auth)
 *   - /api/backup                  — public backup endpoint (download JSON without login)
 *   - /backup/*                    — static backup files
 *
 * Routes that STILL require auth (correctly):
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
export default withAuth({
  pages: {
    signIn: '/login',
  },
})

export const config = {
  matcher: [
    '/api/((?!auth|webhooks|2fa|health|init|owner-auth|system/manifest|system/capabilities|system/capabilities-download|system/backup-download|system/audit|system/self-heal|system/refresh|system/reload|system/seed-agents|system/clear-cache|system/diagnose-email|system/diagnose-llm|system/fix-hydration|system/test-communication|system/zip-backup|system/load-backup|commands/inbound|schedules/tick|monitor|subagents|backup).*)',
  ],
}
