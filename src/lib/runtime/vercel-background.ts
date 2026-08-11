/**
 * Vercel-only adapter for the hosting-neutral background task boundary.
 *
 * This file is the only autonomy-runtime module that imports the Vercel
 * background-lifetime primitive. A future host supplies its own adapter.
 */

import { waitUntil } from '@vercel/functions'
import { configureBackgroundDefer } from './background-tasks'

export function registerVercelBackgroundRuntime(): void {
  configureBackgroundDefer((task) => {
    waitUntil(Promise.resolve(task))
  })
}
