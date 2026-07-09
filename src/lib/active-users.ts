/**
 * active-users.ts — in-memory real-time active-user tracker.
 */
export interface ActiveUser {
  userId: string
  email: string
  name: string
  sessionId: string
  lastSeenAt: number
  page: string
}

export const ACTIVE_WINDOW_MS = 5 * 60 * 1000
export const POLL_INTERVAL_MS = 15 * 1000

const _active = new Map<string, ActiveUser>()

export function touchActiveUser(opts: { userId: string; email?: string; name?: string; sessionId?: string; page?: string }): void {
  if (!opts.userId) return
  const key = `${opts.userId}:${opts.sessionId ?? 'default'}`
  _active.set(key, { userId: opts.userId, email: opts.email ?? '', name: opts.name ?? opts.email ?? 'user', sessionId: opts.sessionId ?? 'default', lastSeenAt: Date.now(), page: opts.page ?? '' })
}

export function removeActiveUser(userId: string, sessionId?: string): void {
  _active.delete(`${userId}:${sessionId ?? 'default'}`)
}

export function getActiveUsers(): ActiveUser[] {
  const now = Date.now()
  const cutoff = now - ACTIVE_WINDOW_MS
  const seen = new Map<string, ActiveUser>()
  for (const [key, u] of _active) {
    if (u.lastSeenAt < cutoff) { _active.delete(key); continue }
    const existing = seen.get(u.userId)
    if (!existing || u.lastSeenAt > existing.lastSeenAt) seen.set(u.userId, u)
  }
  return Array.from(seen.values()).sort((a, b) => b.lastSeenAt - a.lastSeenAt)
}

export function getActiveUserCount(): number { return getActiveUsers().length }

export function pruneStaleEntries(): number {
  const cutoff = Date.now() - ACTIVE_WINDOW_MS
  let removed = 0
  for (const [key, u] of _active) { if (u.lastSeenAt < cutoff) { _active.delete(key); removed++ } }
  return removed
}

if (typeof setInterval !== 'undefined') {
  setInterval(() => { pruneStaleEntries() }, ACTIVE_WINDOW_MS).unref?.()
}
