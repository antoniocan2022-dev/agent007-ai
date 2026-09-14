import { getServerSession } from 'next-auth'
import { authOptions, SEED_EMAIL, hashPassword } from './auth'
import { db } from './db'
import { generateApprovalToken, sendApprovalRequest } from './user-approval'

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
  pendingApproval?: boolean
}

/**
 * Register a new user account. Returns the user (without passwordHash) on success.
 * Validation: email format, password >= 8 chars, email not already taken.
 *
 * Deep-audit fix: this used to create a fully usable account with no approval step at all,
 * directly contradicting user-approval.ts's own documented design ("New users CANNOT log in
 * until approved") -- auth.ts's authorize() never checked isUserApproved(), so anyone who
 * registered could sign in immediately with zero owner involvement. Now generates the same
 * approval-token record processApproval() (/api/auth/approve) already expects and notifies the
 * owner via sendApprovalRequest() -- the existing approval infrastructure, now actually wired to
 * the account it's supposed to gate. The account row itself is still created immediately (existing
 * behavior, needed so the token can reference a real userId); what changes is that authorize()
 * now refuses to issue a session until isUserApproved() returns true for this account.
 *
 * Also refuses to register SEED_EMAIL (the owner's own account) at all: that account is only ever
 * provisioned by ensureSeedUser()+OWNER_BOOTSTRAP_PASSWORD (auth.ts), on the owner's first login
 * attempt. Before this fix, this endpoint would happily create an account under the owner's exact
 * email with an attacker-chosen password if hit before that first login ever happened on a fresh
 * deploy -- ensureSeedUser() only creates the seed user when none exists yet, so it would silently
 * skip an account already claimed this way, permanently locking the real owner out of their own
 * email with their real bootstrap password.
 */
export async function registerUser(email: string, password: string, name?: string): Promise<RegisterResult> {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return { ok: false, error: 'Invalid email address' }
  }
  if (!password || password.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters' }
  }
  if (normalizedEmail === SEED_EMAIL.trim().toLowerCase()) {
    return { ok: false, error: 'This email is reserved for the account owner and cannot self-register.' }
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

    try {
      const approvalToken = generateApprovalToken()
      await db.userSetting.create({
        data: {
          userId: user.id,
          key: `approval_token:${approvalToken}`,
          value: JSON.stringify({ userId: user.id, userEmail: user.email, expiresAt: Date.now() + 24 * 60 * 60 * 1000 }),
        },
      })
      await sendApprovalRequest({ newUserEmail: user.email, newUserName: user.name ?? undefined, approvalToken })
    } catch (e: any) {
      // Best-effort: the account still requires approval even if the notification failed to
      // send -- the owner can still approve from the Dashboard -> Users panel.
      console.warn('[registerUser] Failed to send approval request:', e?.message)
    }

    return {
      ok: true,
      user: { id: user.id, email: user.email, name: user.name ?? user.email },
      pendingApproval: true,
    }
  } catch (e: any) {
    return { ok: false, error: `Registration failed: ${e?.message ?? 'unknown error'}` }
  }
}
