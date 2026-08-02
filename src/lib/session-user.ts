import { getServerSession } from 'next-auth'
import { authOptions, SEED_EMAIL, hashPassword } from './auth'
import { db } from './db'

/**
 * Multi-user support helpers.
 *
 * getSessionUserId() — returns the authenticated user's id from the NextAuth
 * session, falling back to the seed user (OWNER_EMAIL) for
 * backward compatibility with existing data.
 *
 * registerUser() — creates a new user account (used by /api/auth/register).
 *
 * ensureSeedUser() is already defined in auth.ts and called on first auth
 * request — it creates the seed operator if missing.
 */

export async function getSessionUserId(): Promise<string | null> {
  try {
    const session = await getServerSession(authOptions)
    if (session?.user?.email) {
      const user = await db.user.findUnique({ where: { email: session.user.email.toLowerCase() } })
      if (user) return user.id
    }
  } catch {
    // fall through to seed fallback
  }
  // Fallback: return the seed user id (backward compat for pre-multi-user data)
  try {
    const seed = await db.user.findUnique({ where: { email: SEED_EMAIL } })
    return seed?.id ?? null
  } catch {
    return null
  }
}

export async function getSessionUser() {
  try {
    const session = await getServerSession(authOptions)
    if (session?.user?.email) {
      const user = await db.user.findUnique({ where: { email: session.user.email.toLowerCase() } })
      if (user) {
        return {
          id: user.id,
          email: user.email,
          name: user.name ?? user.email,
        }
      }
    }
  } catch {}
  return null
}

export interface RegisterResult {
  ok: boolean
  error?: string
  user?: { id: string; email: string; name: string }
}

/**
 * Register a new user account. Returns the user (without passwordHash) on success.
 * Validation: email format, password >= 8 chars, email not already taken.
 */
export async function registerUser(email: string, password: string, name?: string): Promise<RegisterResult> {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return { ok: false, error: 'Invalid email address' }
  }
  if (!password || password.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters' }
  }

  try {
    const existing = await db.user.findUnique({ where: { email: normalizedEmail } })
    if (existing) {
      return { ok: false, error: 'An account with this email already exists' }
    }

    const passwordHash = await hashPassword(password)
    const user = await db.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        name: name?.trim() || normalizedEmail.split('@')[0],
      },
    })

    return {
      ok: true,
      user: { id: user.id, email: user.email, name: user.name ?? user.email },
    }
  } catch (e: any) {
    return { ok: false, error: `Registration failed: ${e?.message ?? 'unknown error'}` }
  }
}
