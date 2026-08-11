/**
 * Hosting-neutral background task boundary.
 *
 * Core application code must depend on this module, never on a hosting
 * provider's runtime API. A deployment adapter may register a stronger
 * background-lifetime implementation (for example, a provider waitUntil
 * primitive). Without an adapter, work is intentionally best-effort and
 * must not be treated as durable job execution.
 */

export type BackgroundTask = Promise<unknown> | PromiseLike<unknown>
export type BackgroundDefer = (task: BackgroundTask) => void

let defer: BackgroundDefer = (task) => {
  void Promise.resolve(task).catch(() => {})
}

export function configureBackgroundDefer(handler: BackgroundDefer): void {
  defer = handler
}

export function backgroundFire(task: BackgroundTask): void {
  defer(Promise.resolve(task).catch(() => {}))
}
