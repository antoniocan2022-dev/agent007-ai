/**
 * Runtime adapter registration.
 *
 * The application core stays hosting-neutral. Vercel lifecycle support is
 * registered only when running on Vercel; another host can register its own
 * adapter without changing Mission OS or scheduling code.
 */

export async function register(): Promise<void> {
  if (process.env.VERCEL !== '1') return

  try {
    const { registerVercelBackgroundRuntime } = await import('./src/lib/runtime/vercel-background')
    registerVercelBackgroundRuntime()
  } catch (error) {
    console.warn('[instrumentation] Vercel background adapter unavailable:', error instanceof Error ? error.message : String(error))
  }
}
