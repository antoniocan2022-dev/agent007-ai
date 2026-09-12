import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { isTranscribableExtension, MAX_TRANSCRIPTION_BYTES, transcribeAudioOrVideo } from '@/lib/media-transcription'

describe('isTranscribableExtension', () => {
  test('accepts common audio formats', () => {
    for (const ext of ['.mp3', '.wav', '.ogg', '.flac', '.m4a']) expect(isTranscribableExtension(ext)).toBe(true)
  })
  test('accepts the video containers Groq/Whisper-compatible endpoints extract audio from directly', () => {
    expect(isTranscribableExtension('.mp4')).toBe(true)
    expect(isTranscribableExtension('.webm')).toBe(true)
  })
  test('is case-insensitive', () => {
    expect(isTranscribableExtension('.MP3')).toBe(true)
  })
  test('rejects video containers this runtime has no toolchain to transcode', () => {
    for (const ext of ['.avi', '.mov', '.mkv']) expect(isTranscribableExtension(ext)).toBe(false)
  })
  test('rejects non-media extensions', () => {
    expect(isTranscribableExtension('.pdf')).toBe(false)
  })
})

describe('transcribeAudioOrVideo (fails closed, never fabricates)', () => {
  const savedKey = process.env.GROQ_API_KEY

  beforeEach(() => { delete process.env.GROQ_API_KEY })
  afterEach(() => { if (savedKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = savedKey })

  test('reports a clear "not configured" error, not a thrown exception, when GROQ_API_KEY is absent', async () => {
    const result = await transcribeAudioOrVideo(Buffer.from('fake audio bytes'), 'clip.mp3')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('GROQ_API_KEY')
  })

  test('rejects an empty buffer without making a network call', async () => {
    process.env.GROQ_API_KEY = 'test-key-not-used'
    const result = await transcribeAudioOrVideo(Buffer.alloc(0), 'clip.mp3')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Empty file')
  })

  test('rejects a buffer over the endpoint size limit without making a network call', async () => {
    process.env.GROQ_API_KEY = 'test-key-not-used'
    const oversized = Buffer.alloc(MAX_TRANSCRIPTION_BYTES + 1)
    const result = await transcribeAudioOrVideo(oversized, 'clip.mp3')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('over the')
  })
})
