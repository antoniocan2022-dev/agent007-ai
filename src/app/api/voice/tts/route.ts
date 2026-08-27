import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/voice/tts
 * Body: { text: string, voice?: string, speed?: number }
 * Returns audio/wav binary response.
 *
 * Audio transport is handled by OpenAI's dedicated speech endpoint.
 * LLM provider selection remains owned by the canonical control plane.
 */
export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { text, voice, speed } = body as { text?: string; voice?: string; speed?: number }
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return NextResponse.json({ error: 'Missing "text" field' }, { status: 400 })
  }

  const truncated = text.slice(0, 2000)

  try {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('TTS requires OPENAI_API_KEY')
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        input: truncated,
        voice: voice || 'alloy',
        speed: typeof speed === 'number' ? Math.min(2, Math.max(0.25, speed)) : 1.0,
        response_format: 'wav',
      }),
      signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) throw new Error(`TTS failed: HTTP ${response.status}`)
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(new Uint8Array(arrayBuffer))
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(buffer.length),
        'Cache-Control': 'no-cache',
      },
    })
  } catch (e: any) {
    console.error('[tts] failed:', e)
    return NextResponse.json({ error: `TTS failed: ${e?.message ?? String(e)}` }, { status: 500 })
  }
}
