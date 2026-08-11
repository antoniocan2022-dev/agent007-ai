/**
 * Host-neutral internal URL resolver.
 *
 * Application code should not inspect hosting-provider URL variables directly.
 * Explicit public application configuration wins; development falls back to
 * localhost. Production fails closed when no canonical application URL exists.
 */
import { getPublicBaseUrl } from '@/lib/runtime/public-base-url'

export function getInternalBaseUrl(): string {
  try {
    return getPublicBaseUrl()
  } catch {
    if (process.env.NODE_ENV === 'production') throw new Error('Public application URL is not configured')
    return `http://localhost:${process.env.PORT ?? 3000}`
  }
}

export function internalUrl(path: string): string {
  const base = getInternalBaseUrl()
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return `${base}${cleanPath}`
}
