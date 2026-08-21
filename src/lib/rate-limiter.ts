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
 * - /api/auth/password-reset: 10 req/min per IP (reset request abuse protection)
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
  '/api/auth/password-reset': 10,
}

const DEFAULT_LIMIT = 120 // requests per minute
const WINDOW_MS = 60 * 1000 // 1 minute

function isRedisConfigured(): boolean {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
}

async function redisIncrement(key: string, windowMs: number): Promise<number> {
  const url = process.env.UPSTASH_REDIS_REST_URL!
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!
  const redisKey = `ratelimit:${key}`

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
  const count = data?.[0]?.result ?? 1
  return count
}

export function checkRateLimit(ip: string, pathname: string): {
  limited: boolean
  remaining: number
  resetAt: number
  limit: number
} {
  let limit = DEFAULT_LIMIT
  for (const [prefix, lim] of Object.entries(RATE_LIMITS)) {
    if (pathname.startsWith(prefix)) {
      limit = lim
      break
    }
  }

  const key = `${ip}:${pathname.split('/').slice(0, 3).join('/')}`
  const now = Date.now()

  if (store.size > 1000) {
    for (const [k, v] of store.entries()) {
      if (v.resetAt < now) store.delete(k)
    }
  }

  const entry = store.get(key)
  if (!entry || entry.resetAt < now) {
    const newEntry: RateLimitEntry = { count: 1, resetAt: now + WINDOW_MS }
    store.set(key, newEntry)
    return { limited: false, remaining: limit - 1, resetAt: newEntry.resetAt, limit }
  }

  entry.count++
  if (entry.count > limit) {
    return { limited: true, remaining: 0, resetAt: entry.resetAt, limit }
  }

  return { limited: false, remaining: limit - entry.count, resetAt: entry.resetAt, limit }
}

export async function checkRateLimitAsync(ip: string, pathname: string): Promise<{
  limited: boolean
  remaining: number
  resetAt: number
  limit: number
  backend: 'redis' | 'memory'
}> {
  let limit = DEFAULT_LIMIT
  for (const [prefix, lim] of Object.entries(RATE_LIMITS)) {
    if (pathname.startsWith(prefix)) {
      limit = lim
      break
    }
  }

  const key = `${ip}:${pathname.split('/').slice(0, 3).join('/')}`

  if (isRedisConfigured()) {
    try {
      const count = await redisIncrement(key, WINDOW_MS)
      const resetAt = Date.now() + WINDOW_MS
      if (count > limit) {
        return { limited: true, remaining: 0, resetAt, limit, backend: 'redis' }
      }
      return { limited: false, remaining: Math.max(0, limit - count), resetAt, limit, backend: 'redis' }
    } catch (e) {
      console.warn('[rate-limiter] Redis failed, falling back to in-memory:', (e as any)?.message?.slice(0, 100))
    }
  }

  const result = checkRateLimit(ip, pathname)
  return { ...result, backend: 'memory' }
}

export function getClientIP(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  const realIP = req.headers.get('x-real-ip')
  if (realIP) return realIP
  return 'unknown'
}

export function isAuthenticatedRequest(req: Request): boolean {
  const cookie = req.headers.get('cookie') || ''
  if (cookie.includes('next-auth.session-token') || cookie.includes('__Secure-next-auth.session-token')) return true
  if (cookie.includes('owner-backup-token')) return true
  return false
}
