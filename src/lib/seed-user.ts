import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { SEED_EMAIL, getOwnerBootstrapPassword } from '@/lib/owner-config'

export { SEED_EMAIL }

export async function hashPassword(pw: string): Promise<string> {
  const salt = await bcrypt.genSalt(12)
  return bcrypt.hash(pw, salt)
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  try { return await bcrypt.compare(pw, hash) } catch { return false }
}

let seedPromise: Promise<void> | null = null

export function ensureSeedUser(): Promise<void> {
  if (!seedPromise) {
    seedPromise = (async () => {
      try {
        const existing = await db.user.findUnique({ where: { email: SEED_EMAIL } })
        if (existing) return
        const configuredPassword = getOwnerBootstrapPassword()
        if (!configuredPassword) return
        const passwordHash = await hashPassword(configuredPassword)
        await db.user.create({ data: { email: SEED_EMAIL, passwordHash, name: 'Agent007 Operator' } })
      } catch (e: any) {
        console.error('[auth] ensureSeedUser failed:', e?.message ?? String(e))
      }
    })()
  }
  return seedPromise
}
