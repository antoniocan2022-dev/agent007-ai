import { db } from './db'

export type SessionUserLike = { id?: string | null; email?: string | null }

/** Resolve the authenticated application user to the canonical Prisma User id. */
export async function resolveMissionOwnerId(user: SessionUserLike | undefined): Promise<string> {
  const candidateId = user?.id?.trim()
  if (candidateId) {
    const byId = await db.user.findUnique({ where: { id: candidateId } }).catch(() => null)
    if (byId) return byId.id
  }

  const email = user?.email?.trim().toLowerCase()
  if (email) {
    const byEmail = await db.user.findUnique({ where: { email } }).catch(() => null)
    if (byEmail) return byEmail.id
  }

  throw new Error('Authenticated mission owner could not be resolved to a canonical application user.')
}
