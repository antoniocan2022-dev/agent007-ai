import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isOwnerEmail } from '@/lib/owner-config'

const OWNER_AUTH_BRAND = Symbol('agent007.owner-authorization')
const AUTHORIZATION_TTL_MS = 5 * 60 * 1000

export interface VerifiedOwnerAuthorization {
  readonly kind: 'owner-session'
  readonly userId: string
  readonly email: string
  readonly verifiedAt: number
  readonly expiresAt: number
  readonly [OWNER_AUTH_BRAND]: true
}

/**
 * Resolve a short-lived, server-created owner authorization from the current
 * authenticated NextAuth session. Callers never supply the approval boolean.
 */
export async function getVerifiedOwnerAuthorization(): Promise<VerifiedOwnerAuthorization | null> {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email?.trim().toLowerCase()
  const userId = typeof (session?.user as { id?: unknown } | undefined)?.id === 'string'
    ? (session?.user as { id: string }).id
    : ''

  if (!email || !userId || !isOwnerEmail(email)) return null

  const now = Date.now()
  return {
    kind: 'owner-session',
    userId,
    email,
    verifiedAt: now,
    expiresAt: now + AUTHORIZATION_TTL_MS,
    [OWNER_AUTH_BRAND]: true,
  }
}

export function isVerifiedOwnerAuthorization(
  value: unknown,
): value is VerifiedOwnerAuthorization {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<VerifiedOwnerAuthorization>
  return candidate.kind === 'owner-session'
    && candidate[OWNER_AUTH_BRAND] === true
    && typeof candidate.userId === 'string'
    && candidate.userId.length > 0
    && typeof candidate.email === 'string'
    && isOwnerEmail(candidate.email)
    && Number.isFinite(candidate.verifiedAt)
    && Number.isFinite(candidate.expiresAt)
    && candidate.expiresAt > Date.now()
}
