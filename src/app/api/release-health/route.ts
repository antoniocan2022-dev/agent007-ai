import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      service: 'agent007',
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown',
      releaseGate: true,
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}
