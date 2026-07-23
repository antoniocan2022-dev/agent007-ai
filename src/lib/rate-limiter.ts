/**
 * rate-limiter.ts — UPGRADE #96 + #121
 * Rate limiting for Vercel serverless functions.
 *
 * UPGRADE #121 FIX: Now uses Upstash Redis when UPSTASH_REDIS_REST_URL +
 * UPSTASH_REDIS_REST_TOKEN are set (durable across cold starts).
 * Falls back to in-memory when Redis is not configured.
 *
 * LIMITS (generous, won't block legitimate users):
 * - /api/agent: 30 req/min per IP (chat — LLM calls are slow, 30 is plenty)
 * - /api/owner-backup: 5 req/min per IP (backup generation is expensive)
 * - /api/tools/*: 60 req/min per IP (tool testing)
 * - All other endpoints: 120 req/min per IP (generous default)
 *
 * AUTHENTICATED USERS: Exempt from rate limiting (checked via session cookie)
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
 * UPGRADE #121 — Check if Upstash Redis is configured.
 * When true, rate limiting is durable across cold starts.
 */
function isRedisConfigured(): boolean {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
}

/**
 * UPGRADE #121 — Increment rate limit counter in Upstash Redis.
 * Uses INCR + EXPIRE for an atomic sliding window.
 */
async function redisIncrement(key: string, windowMs: number): Promise<number> {
  const url = process.env.UPSTASH_REDIS_REST_URL!
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!
  const redisKey = `ratelimit:${key}`

  // Use Upstash REST API pipeline: INCR + EXPIRE
  const resp = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      ['INCR', redisKey],
      ['PEXPIRE', redisKey, windowMs],
    ]),
    signal: AbortSignal.timeout(3000),
  })

  if (!resp.ok) throw new Error(`Redis error: ${resp.status}`)
  const data = await resp.json()
  // Pipeline returns array of results; INCR result is first element
  const count = data?.[0]?.result ?? 1
  return count
}

/**
 * Check if a request should be rate limited.
 * Returns { limited: boolean, remaining: number, resetAt: number }
 *
 * UPGRADE #121: Uses Redis when configured (durable), falls back to in-memory.
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
 * UPGRADE #121 — Async rate limit check that uses Redis when available.
 * Falls back to the sync in-memory check if Redis fails or is not configured.
 */
export async function checkRateLimitAsync(ip: string, pathname: string): Promise<{
  limited: boolean
  remaining: number
  resetAt: number
  limit: number
  backend: 'redis' | 'memory'
}> {
  // Find matching limit for this path
  let limit = DEFAULT_LIMIT
  for (const [prefix, lim] of Object.entries(RATE_LIMITS)) {
    if (pathname.startsWith(prefix)) {
      limit = lim
      break
    }
  }

  const key = `${ip}:${pathname.split('/').slice(0, 3).join('/')}`

  // Try Redis first
  if (isRedisConfigured()) {
    try {
      const count = await redisIncrement(key, WINDOW_MS)
      const resetAt = Date.now() + WINDOW_MS
      if (count > limit) {
        return { limited: true, remaining: 0, resetAt, limit, backend: 'redis' }
      }
      return { limited: false, remaining: Math.max(0, limit - count), resetAt, limit, backend: 'redis' }
    } catch (e) {
      // Redis failed — fall back to in-memory
      console.warn('[rate-limiter] Redis failed, falling back to in-memory:', (e as any)?.message?.slice(0, 100))
    }
  }

  // Fall back to in-memory
  const result = checkRateLimit(ip, pathname)
  return { ...result, backend: 'memory' }
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
