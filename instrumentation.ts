/**
 * Runtime adapter registration.
 *
 * The application core stays hosting-neutral. Hosting lifecycle/storage support
 * is registered through explicit adapters; legacy integrations receive the
 * canonical public URL through NEXTAUTH_URL so they do not fall back to a
 * provider-specific deployment URL.
 */

import { getPublicBaseUrl } from './src/lib/runtime/public-base-url'

export async function register(): Promise<void> {
  try {
    if (!process.env.NEXTAUTH_URL) process.env.NEXTAUTH_URL = getPublicBaseUrl()
  } catch (error) {
    if (process.env.NODE_ENV === 'production') {
      console.warn('[instrumentation] Public application URL is not configured:', error instanceof Error ? error.message : String(error))
    }
  }

  if (process.env.VERCEL !== '1') return

  try {
    const { registerVercelBackgroundRuntime } = await import('./src/lib/runtime/vercel-background')
    registerVercelBackgroundRuntime()
  } catch (error) {
    console.warn('[instrumentation] Vercel background adapter unavailable:', error instanceof Error ? error.message : String(error))
  }

  try {
    const { registerObjectStorageAdapter } = await import('./src/lib/storage/object-storage')
    const { vercelBlobAdapter } = await import('./src/lib/storage/vercel-blob')
    if (vercelBlobAdapter.isConfigured()) registerObjectStorageAdapter(vercelBlobAdapter)
  } catch (error) {
    console.warn('[instrumentation] Vercel object-storage adapter unavailable:', error instanceof Error ? error.message : String(error))
  }
}
