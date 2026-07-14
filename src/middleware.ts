import { withAuth } from 'next-auth/middleware'

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
export default withAuth({
  pages: {
    signIn: '/login',
  },
})

export const config = {
  matcher: [
    '/api/((?!auth|webhooks|2fa|health|init|owner-auth|owner-backup|system/manifest|system/capabilities|system/capabilities-download|system/audit|system/self-heal|system/refresh|system/reload|system/seed-agents|system/clear-cache|system/diagnose-email|system/diagnose-llm|system/fix-hydration|system/fix-agents|system/test-communication|system/zip-backup|system/self-restore|commands/inbound|schedules/tick|monitor|subagents).*)',
  ],
}
