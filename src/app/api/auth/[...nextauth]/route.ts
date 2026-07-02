import NextAuth from 'next-auth'
import { authOptions, ensureSeedUser } from '@/lib/auth'

const handler = NextAuth(authOptions)

export async function GET(req: Request, ctx: { params: Promise<{ nextauth: string[] }> }) {
  await ensureSeedUser().catch((e) => console.error('[...nextauth] seed failed:', e))
  return handler(req, ctx)
}

export async function POST(req: Request, ctx: { params: Promise<{ nextauth: string[] }> }) {
  await ensureSeedUser().catch((e) => console.error('[...nextauth] seed failed:', e))
  return handler(req, ctx)
}
