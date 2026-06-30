import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

let _zai: ZAI | null = null
async function getZai(): Promise<ZAI> {
  if (!_zai) _zai = await ZAI.create()
  return _zai
}

/**
 * POST /api/voice/tts
 * Body: { text: string, voice?: string, speed?: number }
 *
 * Uses z-ai-web-dev-sdk audio.tts.create to synthesize speech.
 * Returns audio/wav binary response.
 *
 * Voices: tongtong (default), and others the SDK supports.
 * Speed: 0.5 - 2.0 (default 1.0)
 */
export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { text, voice, speed } = body as {
    text?: string
    voice?: string
    speed?: number
  }

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return NextResponse.json({ error: 'Missing "text" field' }, { status: 400 })
  }

  // Truncate very long texts (TTS APIs typically cap at ~1000 chars)
  const truncated = text.slice(0, 2000)

  try {
    const zai = await getZai()
    const response = await zai.audio.tts.create({
      input: truncated,
      voice: voice || 'tongtong',
      speed: typeof speed === 'number' ? Math.min(2, Math.max(0.5, speed)) : 1.0,
      response_format: 'wav',
      stream: false,
    })

    // response is a fetch Response object — get the audio bytes
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
    return NextResponse.json(
      { error: `TTS failed: ${e?.message ?? String(e)}` },
      { status: 500 }
    )
  }
}
