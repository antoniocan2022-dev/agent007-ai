import { NextResponse } from 'next/server'
import { getCanonicalRuntimeManifest } from '@/lib/canonical-runtime-manifest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const manifest = getCanonicalRuntimeManifest()
  return NextResponse.json(manifest, { headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' } })
}
