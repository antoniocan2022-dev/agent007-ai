import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  const releaseCommit =
    process.env.RELEASE_COMMIT_SHA?.trim() ||
    process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
    'unknown'

  return NextResponse.json(
    {
      ok: true,
      service: 'agent007',
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown',
      releaseGate: true,
      releaseCommit,
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}
