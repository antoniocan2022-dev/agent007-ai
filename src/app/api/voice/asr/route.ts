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
 * POST /api/voice/asr
 * Body: { audio_base64: string } OR multipart/form-data with field "audio"
 *
 * Uses z-ai-web-dev-sdk audio.asr.create to transcribe speech to text.
 * Returns { text: string }
 *
 * Accepts base64-encoded audio (the client records via MediaRecorder and
 * sends the WAV/webm bytes as base64). For multipart, the audio file is
 * read into a buffer and base64-encoded server-side.
 */
export async function POST(req: NextRequest) {
  let audioBase64: string | null = null

  const contentType = req.headers.get('content-type') || ''

  if (contentType.includes('multipart/form-data')) {
    // Multipart upload — extract the audio file
    const formData = await req.formData()
    const file = formData.get('audio')
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'Missing "audio" file in form data' }, { status: 400 })
    }
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(new Uint8Array(arrayBuffer))
    audioBase64 = buffer.toString('base64')
  } else {
    // JSON body with base64
    let body: any
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    audioBase64 = body?.audio_base64
  }

  if (!audioBase64 || typeof audioBase64 !== 'string') {
    return NextResponse.json({ error: 'Missing audio data' }, { status: 400 })
  }

  try {
    const zai = await getZai()
    const response = await zai.audio.asr.create({
      file_base64: audioBase64,
    })

    const text = (response as any)?.text || ''
    return NextResponse.json({ text })
  } catch (e: any) {
    console.error('[asr] failed:', e)
    return NextResponse.json(
      { error: `ASR failed: ${e?.message ?? String(e)}` },
      { status: 500 }
    )
  }
}
