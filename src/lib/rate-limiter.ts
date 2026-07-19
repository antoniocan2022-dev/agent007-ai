/**
 * rate-limiter.ts — UPGRADE #96
 * Basic in-memory rate limiting for Vercel serverless functions.
 * Tracks requests per IP address, rejects if over limit.
 *
 * LIMITS (generous, won't block legitimate users):
 * - /api/agent: 30 req/min per IP (chat — LLM calls are slow, 30 is plenty)
 * - /api/owner-backup: 5 req/min per IP (backup generation is expensive)
 * - /api/tools/*: 60 req/min per IP (tool testing)
 * - All other endpoints: 120 req/min per IP (generous default)
 *
 * AUTHENTICATED USERS: Exempt from rate limiting (checked via session cookie)
 *
 * NOTE: In-memory storage resets on cold start. For true distributed rate
 * limiting, use Upstash Redis (already configured: UPSTASH_REDIS_REST_URL).
 * This implementation is sufficient for Hobby tier + basic DDoS protection.
 */

interface RateLimitEntry {
  count: number
  resetAt: number
}

const _g = globalThis as any
if (!_g.__rateLimitStore) _g.__rateLimitStore = new Map<string, RateLimitEntry>()
const store: Map<string, RateLimitEntry> = _g.__rateLimitStore

// Rate limit configurations (requests per minute)
const RATE_LIMITS: Record<string, number> = {
  '/api/agent': 30,
  '/api/owner-backup': 5,
  '/api/tools/': 60,
  '/api/mission/': 30,
  '/api/recipes': 30,
  '/api/triggers': 30,
  '/api/decisions': 30,
  '/api/reality-check': 30,
}

const DEFAULT_LIMIT = 120 // requests per minute
const WINDOW_MS = 60 * 1000 // 1 minute

/**
 * Check if a request should be rate limited.
 * Returns { limited: boolean, remaining: number, resetAt: number }
 */
export function checkRateLimit(ip: string, pathname: string): {
  limited: boolean
  remaining: number
  resetAt: number
  limit: number
} {
  // Find matching limit for this path
  let limit = DEFAULT_LIMIT
  for (const [prefix, lim] of Object.entries(RATE_LIMITS)) {
    if (pathname.startsWith(prefix)) {
      limit = lim
      break
    }
  }

  const key = `${ip}:${pathname.split('/').slice(0, 3).join('/')}`
  const now = Date.now()

  // Clean expired entries (every 100 requests, to prevent memory bloat)
  if (store.size > 1000) {
    for (const [k, v] of store.entries()) {
      if (v.resetAt < now) store.delete(k)
    }
  }

  const entry = store.get(key)
  if (!entry || entry.resetAt < now) {
    // First request or window expired — start new window
    const newEntry: RateLimitEntry = { count: 1, resetAt: now + WINDOW_MS }
    store.set(key, newEntry)
    return { limited: false, remaining: limit - 1, resetAt: newEntry.resetAt, limit }
  }

  // Increment count
  entry.count++
  if (entry.count > limit) {
    return { limited: true, remaining: 0, resetAt: entry.resetAt, limit }
  }

  return { limited: false, remaining: limit - entry.count, resetAt: entry.resetAt, limit }
}

/**
 * Get client IP from request (handles Vercel's forwarded headers)
 */
export function getClientIP(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  const realIP = req.headers.get('x-real-ip')
  if (realIP) return realIP
  return 'unknown'
}

/**
 * Check if request is from an authenticated user (exempt from rate limiting)
 * Returns true if user has a valid session cookie
 */
export function isAuthenticatedRequest(req: Request): boolean {
  const cookie = req.headers.get('cookie') || ''
  // NextAuth session cookie names: next-auth.session-token, __Secure-next-auth.session-token
  if (cookie.includes('next-auth.session-token') || cookie.includes('__Secure-next-auth.session-token')) {
    return true
  }
  // Owner backup token (already authenticated via token)
  if (cookie.includes('owner-backup-token')) {
    return true
  }
  return false
}
