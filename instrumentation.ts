/**
 * Runtime adapter registration.
 *
 * The application core stays hosting-neutral. Vercel lifecycle/storage support
 * is registered only when running on Vercel; another host can register its own
 * adapters without changing Mission OS, scheduling, checkout or fulfillment.
 */

export async function register(): Promise<void> {
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
