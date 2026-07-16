/**
 * /api/triggers — UPGRADE #88
 * External trigger ingestion endpoint.
 * Receives triggers from email, WhatsApp, webhook, or SMS sources.
 */
import { NextRequest, NextResponse } from 'next/server'
import { toolExternalTrigger } from '@/lib/max-autonomy-engine'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const action = url.searchParams.get('action') ?? 'pending'
  const result = await toolExternalTrigger({ action })
  return NextResponse.json({
    ok: result.ok,
    preview: result.preview,
    result: result.result,
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const action = body.action ?? 'queue'
  const result = await toolExternalTrigger({ action, ...body })
  return NextResponse.json({
    ok: result.ok,
    preview: result.preview,
    result: result.result,
  })
}
