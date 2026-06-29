import NextAuth from 'next-auth'
import { authOptions, ensureSeedUser } from '@/lib/auth'

// Boot the seed operator account on EVERY NextAuth route hit (GET/POST).
// ensureSeedUser() is idempotent — it only creates the user if missing.
// This guards against the user being locked out if the DB was wiped between
// requests. The password itself is NOT touched here; that's the job of
// /api/auth/force-reset and /api/auth/reset-password.
const handler = NextAuth(authOptions)

export async function GET(req: Request, ctx: { params: { nextauth: string[] } }) {
  await ensureSeedUser().catch((e) => {
    console.error('[...nextauth] seed failed:', e)
  })
  return handler(req, ctx)
}

export async function POST(req: Request, ctx: { params: { nextauth: string[] } }) {
  await ensureSeedUser().catch((e) => {
    console.error('[...nextauth] seed failed:', e)
  })
  return handler(req, ctx)
}
