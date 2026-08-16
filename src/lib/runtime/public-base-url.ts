const LOCAL_DEFAULT = 'http://localhost:3000'

function normalize(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

export function getPublicBaseUrl(): string {
  const configured = process.env.PUBLIC_APP_URL || process.env.NEXTAUTH_URL
  if (configured?.trim()) return normalize(configured)
  if (process.env.NODE_ENV !== 'production') return LOCAL_DEFAULT
  throw new Error('PUBLIC_APP_URL or NEXTAUTH_URL must be configured in production')
}

export function getPublicBaseUrlFromRequest(req: Request): string {
  const configured = process.env.PUBLIC_APP_URL || process.env.NEXTAUTH_URL
  if (configured?.trim()) return normalize(configured)

  const origin = req.headers.get('origin')?.trim()
  if (origin) return normalize(origin)

  const forwardedHost = req.headers.get('x-forwarded-host')?.trim()
  const forwardedProto = req.headers.get('x-forwarded-proto')?.trim() || 'https'
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`.replace(/\/+$/, '')

  if (process.env.NODE_ENV !== 'production') return LOCAL_DEFAULT
  throw new Error('No public application URL could be determined in production')
}
