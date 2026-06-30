/**
 * In-process load tracker for interactive-vs-scheduled prioritization.
 *
 * When a user sends a chat message via /api/agent, we increment
 * `activeInteractiveCount`. The /api/schedules/tick endpoint checks
 * this counter BEFORE dispatching any scheduled run; if there's an
 * active interactive request, the scheduled dispatch is skipped (the
 * schedule will retry on the next tick).
 *
 * In-memory only — never persisted. A runtime concern; resets on
 * server restart.
 *
 * Server-only. Never import from a client component.
 */

export const loadTracker: {
  activeInteractiveCount: number
} = {
  activeInteractiveCount: 0,
}

export function beginInteractive(): void {
  loadTracker.activeInteractiveCount++
  if (loadTracker.activeInteractiveCount < 0) {
    // Defensive: should never happen, but guard against double-decrements
    loadTracker.activeInteractiveCount = 0
  }
}

export function endInteractive(): void {
  loadTracker.activeInteractiveCount--
  if (loadTracker.activeInteractiveCount < 0) {
    loadTracker.activeInteractiveCount = 0
  }
}

export function isInteractiveActive(): boolean {
  return loadTracker.activeInteractiveCount > 0
}
