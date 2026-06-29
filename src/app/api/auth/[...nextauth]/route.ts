import NextAuth from 'next-auth'
import { authOptions, ensureSeedUser } from '@/lib/auth'

// Boot the seed operator account on cold start.
ensureSeedUser().catch((e) => {
  console.error('[...nextauth] seed failed:', e)
})

const handler = NextAuth(authOptions)

export { handler as GET, handler as POST }
