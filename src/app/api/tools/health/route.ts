import { NextRequest, NextResponse } from 'next/server'
import { toolHealthChecker } from '@/lib/tool-testing-coordination'
export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  const action = new URL(req.url).searchParams.get('action') ?? 'summary'
  const r = await toolHealthChecker({ action })
  return NextResponse.json({ ok: r.ok, preview: r.preview, result: r.result })
}
export async function POST(req: NextRequest) {
  const r = await toolHealthChecker(await req.json().catch(() => ({})))
  return NextResponse.json({ ok: r.ok, preview: r.preview, result: r.result })
}
