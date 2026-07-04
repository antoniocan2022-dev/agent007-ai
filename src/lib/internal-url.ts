/**
 * internal-url.ts — Returns the correct base URL for internal API calls.
 *
 * On Vercel serverless, localhost:3000 doesn't exist — the server
 * doesn't listen on a port. We need to use the Vercel URL instead.
 *
 * On dev (localhost), we use http://localhost:3000.
 */

/**
 * Get the base URL for internal API calls.
 * - Vercel: https://agent007-ai.vercel.app (from VERCEL_URL or NEXTAUTH_URL)
 * - Dev: http://localhost:3000
 */
export function getInternalBaseUrl(): string {
  // Vercel automatically sets VERCEL_URL (e.g. "agent007-ai-xxx.vercel.app")
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }

  // NEXTAUTH_URL is set on Vercel (e.g. "https://agent007-ai.vercel.app")
  if (process.env.NEXTAUTH_URL) {
    return process.env.NEXTAUTH_URL.replace(/\/$/, '')
  }

  // Dev environment
  return `http://localhost:${process.env.PORT ?? 3000}`
}

/**
 * Build a full internal API URL from a path.
 * Example: internalUrl('/api/system/audit') → 'https://agent007-ai.vercel.app/api/system/audit'
 */
export function internalUrl(path: string): string {
  const base = getInternalBaseUrl()
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return `${base}${cleanPath}`
}
