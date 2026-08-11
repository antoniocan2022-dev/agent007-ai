/**
 * Vercel-only adapter for the hosting-neutral background task boundary.
 *
 * Keeping this import isolated means the Agent007 application and Mission OS
 * do not depend directly on @vercel/functions. A future host only needs its
 * own adapter; core scheduling code remains unchanged.
 */

import { waitUntil } from '@vercel/functions'
import { configureBackgroundDefer } from './background-tasks'

export function registerVercelBackgroundRuntime(): void {
  configureBackgroundDefer((task) => {
    waitUntil(Promise.resolve(task))
  })
}
