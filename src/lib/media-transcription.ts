// Real speech-to-text for audio and video attachments, shared by media-tools.ts's audio/video
// tools and the knowledge-ingestion pipeline (document-ingestion.ts) so there is exactly one
// transcription implementation in this codebase, not two that could silently drift apart.
//
// Uses Groq's OpenAI-compatible audio transcription endpoint under GROQ_API_KEY -- already a real,
// configured provider credential in provider-control-plane.ts for chat completions. No new
// dependency or credential to provision. media-tools.ts previously called OpenAI's transcription
// endpoint under OPENAI_API_KEY, a credential this project's canonical provider control plane does
// not configure anywhere -- meaning that path silently and permanently failed closed in production.
//
// Fails closed on any problem (missing key, network error, timeout, non-2xx response, empty
// transcript): callers must treat a null result as "transcription unavailable for this file" and
// say so honestly, never fabricate or guess at spoken content.

const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
// whisper-large-v3-turbo trades a little accuracy for substantially lower latency/cost than
// whisper-large-v3; either is a genuine Whisper model Groq hosts, not a placeholder.
const TRANSCRIPTION_MODEL = 'whisper-large-v3-turbo'
const TRANSCRIPTION_TIMEOUT_MS = 60_000
// Groq's audio endpoint (like OpenAI's Whisper API it is compatible with) caps request bodies at
// 25MB. A video file's audio track alone is almost always far smaller than the container, but the
// raw container itself commonly exceeds this -- callers ingesting from OCI should extract/trim
// before calling this for anything larger, which this module cannot do without an audio toolchain
// (ffmpeg) that is not available in this runtime.
export const MAX_TRANSCRIPTION_BYTES = 25 * 1024 * 1024

// Formats Groq's Whisper endpoint accepts directly -- audio formats plus the common video
// containers whose audio track the endpoint extracts server-side. Anything else (avi, mov, mkv)
// would need local transcoding this runtime cannot perform, so it is honestly reported as
// unsupported rather than silently skipped or guessed at.
const SUPPORTED_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.mp4', '.webm', '.mpeg', '.mpga'])

export type TranscriptionResult = { ok: true; text: string; model: string } | { ok: false; error: string }

export function isTranscribableExtension(ext: string): boolean {
  return SUPPORTED_EXTENSIONS.has(ext.toLowerCase())
}

export async function transcribeAudioOrVideo(buffer: Buffer, filename: string, signal?: AbortSignal): Promise<TranscriptionResult> {
  const apiKey = process.env.GROQ_API_KEY?.trim()
  if (!apiKey) return { ok: false, error: 'Transcription requires GROQ_API_KEY to be configured.' }
  if (!buffer.length) return { ok: false, error: 'Empty file -- nothing to transcribe.' }
  if (buffer.length > MAX_TRANSCRIPTION_BYTES) {
    return { ok: false, error: `File is ${Math.round(buffer.length / 1024 / 1024)}MB, over the ${MAX_TRANSCRIPTION_BYTES / 1024 / 1024}MB limit this endpoint accepts. Trim or extract the audio track first.` }
  }
  try {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(buffer)]), filename)
    form.append('model', TRANSCRIPTION_MODEL)
    form.append('response_format', 'json')
    const timeoutSignal = AbortSignal.timeout(TRANSCRIPTION_TIMEOUT_MS)
    const response = await fetch(GROQ_TRANSCRIPTION_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      return { ok: false, error: `Groq transcription failed: HTTP ${response.status}${body ? ` -- ${body.slice(0, 300)}` : ''}` }
    }
    const payload = await response.json().catch(() => null) as { text?: unknown } | null
    const text = typeof payload?.text === 'string' ? payload.text.trim() : ''
    if (!text) return { ok: false, error: 'Groq returned no transcript text.' }
    return { ok: true, text, model: TRANSCRIPTION_MODEL }
  } catch (error: any) {
    return { ok: false, error: `Transcription request failed: ${error?.message ?? error}` }
  }
}
