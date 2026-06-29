import { RATE_LIMIT_INFO } from '@/lib/agent'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/health/llm
 *
 * Returns the current rate-limit state of the primary LLM provider.
 * Polled by the chat-header status indicator every 30s.
 *
 * `status` is one of:
 *   - 'ok'           — no recent 429, provider healthy
 *   - 'rate_limited' — a 429 happened within the last 60s, cooldown active
 */
export async function GET() {
  const now = Date.now()
  const cooldownMs = 60_000
  const cooldownUntil = RATE_LIMIT_INFO.last429At
    ? RATE_LIMIT_INFO.last429At + cooldownMs
    : 0
  const status: 'ok' | 'rate_limited' =
    now < cooldownUntil ? 'rate_limited' : 'ok'

  return Response.json({
    status,
    last429At: RATE_LIMIT_INFO.last429At,
    cooldownMs: Math.max(0, cooldownUntil - now),
    retryingNow: RATE_LIMIT_INFO.retryingNow,
  })
}
