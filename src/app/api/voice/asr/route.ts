import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/voice/asr
 * Body: { audio_base64: string } OR multipart/form-data with field "audio"
 * Returns { text: string }
 *
 * Audio transport is handled by OpenAI's dedicated transcription endpoint.
 * LLM provider selection remains owned by the canonical control plane.
 */
export async function POST(req: NextRequest) {
  let audioBase64: string | null = null
  const contentType = req.headers.get('content-type') || ''

  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData()
    const file = formData.get('audio')
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'Missing "audio" file in form data' }, { status: 400 })
    }
    const arrayBuffer = await file.arrayBuffer()
    audioBase64 = Buffer.from(new Uint8Array(arrayBuffer)).toString('base64')
  } else {
    try {
      const body = await req.json()
      audioBase64 = body?.audio_base64
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
  }

  if (!audioBase64 || typeof audioBase64 !== 'string') {
    return NextResponse.json({ error: 'Missing audio data' }, { status: 400 })
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('ASR requires OPENAI_API_KEY')
    const form = new FormData()
    form.append('file', new Blob([Buffer.from(audioBase64, 'base64')], { type: 'audio/webm' }), 'audio.webm')
    form.append('model', 'whisper-1')
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) throw new Error(`ASR failed: HTTP ${response.status}`)
    const data = await response.json()
    return NextResponse.json({ text: data?.text || '' })
  } catch (e: any) {
    console.error('[asr] failed:', e)
    return NextResponse.json({ error: `ASR failed: ${e?.message ?? String(e)}` }, { status: 500 })
  }
}
