import { getServerSession } from 'next-auth'
import { db } from '@/lib/db'

export async function requireAttachmentOwner() {
  const session = await getServerSession()
  const email = session?.user?.email?.trim().toLowerCase()
  if (!email) throw new Error('Unauthorized')
  const user = await db.user.findUnique({ where: { email } })
  if (!user) throw new Error('Authenticated user record not found.')
  return user
}
