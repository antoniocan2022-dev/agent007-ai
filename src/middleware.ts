import { withAuth } from 'next-auth/middleware'

/**
 * Fix #2 (upgrade #53) — Auth middleware protecting ALL API routes.
 *
 * Every /api/* route (except auth, webhooks, health, 2fa, and public
 * system endpoints) now requires an authenticated session.
 *
 * EXCEPTIONS (accessible without login):
 *   - /api/auth/* — NextAuth routes
 *   - /api/webhooks/* — Stripe, PayPal webhooks
 *   - /api/2fa/* — 2FA challenge/verify (needed before login)
 *   - /api/health/* — health checks
 *   - /api/init — initialization
 *   - /api/owner-auth/* — owner auth flow
 *   - /api/system/manifest, capabilities, capabilities-download — public info
 *   - /api/system/backup-download — owner auth via label
 *   - /api/system/audit, self-heal, refresh, reload, seed-agents — public health
 *   - /api/system/clear-cache, diagnose-email, diagnose-llm — public diagnostics
 *   - /api/system/fix-hydration, test-communication, zip-backup — public ops
 *   - /api/commands/inbound — webhook from email/SMS
 *   - /api/schedules/tick — cron job
 *   - /backup/* — static backup files
 */
export default withAuth({
  pages: {
    signIn: '/login',
  },
})

export const config = {
  matcher: [
    '/api/((?!auth|webhooks|2fa|health|init|owner-auth|system/manifest|system/capabilities|system/capabilities-download|system/backup-download|system/audit|system/self-heal|system/refresh|system/reload|system/seed-agents|system/clear-cache|system/diagnose-email|system/diagnose-llm|system/fix-hydration|system/test-communication|system/zip-backup|commands/inbound|schedules/tick).*)',
  ],
}
