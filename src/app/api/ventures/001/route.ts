import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { ensureVenture001, getVenture001State } from '@/lib/venture-001'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function requireSession() {
  const session = await getServerSession(authOptions)
  return session?.user ? null : NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
}

export async function GET() {
  const denied = await requireSession()
  if (denied) return denied
  return NextResponse.json({ ok: true, ...(await getVenture001State()) })
}

export async function POST() {
  const denied = await requireSession()
  if (denied) return denied
  try {
    const result = await ensureVenture001()
    return NextResponse.json({ ok: true, ...result }, { status: result.created ? 201 : 200 })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Venture 001 initialization failed.' }, { status: 500 })
  }
}
