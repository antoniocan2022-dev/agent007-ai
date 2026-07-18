import { NextRequest, NextResponse } from 'next/server'
import { toolAccuracyBenchmark } from '@/lib/tool-testing-coordination'
export const dynamic = 'force-dynamic'
export const maxDuration = 300
export async function GET(req: NextRequest) {
  const action = new URL(req.url).searchParams.get('action') ?? 'list'
  const r = await toolAccuracyBenchmark({ action })
  return NextResponse.json({ ok: r.ok, preview: r.preview, result: r.result })
}
export async function POST(req: NextRequest) {
  const r = await toolAccuracyBenchmark(await req.json().catch(() => ({})))
  return NextResponse.json({ ok: r.ok, preview: r.preview, result: r.result })
}
