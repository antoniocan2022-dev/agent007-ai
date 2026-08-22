import { NextResponse } from 'next/server'
import { getHuggingFaceModel, isHuggingFaceConfigured, probeHuggingFace } from '@/lib/huggingface-runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Independently verifies the Hugging Face Inference Providers connection.
 * Never returns HF_TOKEN and never mutates provider state.
 */
export async function GET() {
  const startedAt = Date.now()
  const configured = isHuggingFaceConfigured()

  if (!configured) {
    return NextResponse.json({
      ok: false,
      provider: 'huggingface',
      configured: false,
      working: false,
      model: null,
      durationMs: Date.now() - startedAt,
      error: 'HF_TOKEN is not configured',
    }, { status: 503 })
  }

  const probe = await probeHuggingFace()
  return NextResponse.json({
    ok: probe.success,
    provider: 'huggingface',
    configured: probe.configured,
    working: probe.success,
    model: probe.model ?? getHuggingFaceModel(),
    responseMs: probe.responseMs,
    durationMs: Date.now() - startedAt,
    error: probe.error ?? null,
  }, { status: probe.success ? 200 : 503 })
}
