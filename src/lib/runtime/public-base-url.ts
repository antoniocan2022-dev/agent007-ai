const LOCAL_DEFAULT = 'http://localhost:3000'

function normalize(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

export function getPublicBaseUrl(): string {
  const configured = process.env.PUBLIC_APP_URL || process.env.NEXTAUTH_URL
  if (configured?.trim()) return normalize(configured)

  // Vercel exposes VERCEL_URL for every deployment, including Preview.
  // Use it as the hosting-safe fallback when an explicit public URL is not
  // configured, while preserving the explicit production configuration path.
  const vercelUrl = process.env.VERCEL_URL
  if (vercelUrl?.trim()) return `https://${normalize(vercelUrl)}`

  if (process.env.NODE_ENV !== 'production') return LOCAL_DEFAULT

  throw new Error('PUBLIC_APP_URL, NEXTAUTH_URL, or VERCEL_URL must be configured in production')
}

export function getPublicBaseUrlFromRequest(req: Request): string {
  const configured = process.env.PUBLIC_APP_URL || process.env.NEXTAUTH_URL
  if (configured?.trim()) return normalize(configured)

  const origin = req.headers.get('origin')?.trim()
  if (origin) return normalize(origin)

  const forwardedHost = req.headers.get('x-forwarded-host')?.trim()
  const forwardedProto = req.headers.get('x-forwarded-proto')?.trim() || 'https'
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`.replace(/\/+$/, '')

  const vercelUrl = process.env.VERCEL_URL
  if (vercelUrl?.trim()) return `https://${normalize(vercelUrl)}`

  if (process.env.NODE_ENV !== 'production') return LOCAL_DEFAULT
  throw new Error('No public application URL could be determined in production')
}
