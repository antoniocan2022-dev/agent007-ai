import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { toolAudioProcess, toolDirectoryList, toolFileCreate, toolFileDelete, toolFileReadAny, toolVideoProcess } from '@/lib/media-tools'

const ROOT = join(import.meta.dir, '..')
const ctx = { attachments: [], language: 'en' as const }

describe('media-tools.ts honesty fixes (source-level)', () => {
  const source = readFileSync(join(ROOT, 'src/lib/media-tools.ts'), 'utf-8')

  test('BASE_DIR no longer hardcodes the stale local dev path', () => {
    expect(source).not.toContain('/home/z/my-project')
    expect(source).toContain('const BASE_DIR = process.cwd()')
  })

  test('the module docstring no longer claims access to ANY type of file/video/audio', () => {
    expect(source).not.toContain('Agent007 can create, read, delete, modify ANY type of file')
  })

  test('audio and video transcription both route through the shared, real transcribeAudioOrVideo helper', () => {
    expect(source).toContain("import { transcribeAudioOrVideo, isTranscribableExtension } from './media-transcription'")
    expect(source).not.toContain('OPENAI_API_KEY')
    expect(source).not.toContain('api.openai.com/v1/audio/transcriptions')
  })

  test('video_process gained a transcribe action alongside frames/info', () => {
    expect(source).toContain("'info' | 'frames' | 'transcribe'")
  })
})

describe('toolFileCreate / toolFileReadAny / toolFileDelete (real filesystem I/O against an absolute /tmp path)', () => {
  const tmpFile = path.join(os.tmpdir(), `media-tools-test-${Date.now()}.txt`)

  afterEach(async () => { await fsp.unlink(tmpFile).catch(() => {}) })

  test('creates, reads back, and deletes a file at an absolute path (unaffected by BASE_DIR)', async () => {
    const created = await toolFileCreate({ filepath: tmpFile, content: 'hello from a test' }, ctx)
    expect(created.ok).toBe(true)

    const read = await toolFileReadAny({ filepath: tmpFile }, ctx)
    expect(read.ok).toBe(true)
    expect(read.result).toContain('hello from a test')

    const deleted = await toolFileDelete({ filepath: tmpFile }, ctx)
    expect(deleted.ok).toBe(true)
  })
})

describe('toolAudioProcess transcribe action (fails closed honestly without GROQ_API_KEY)', () => {
  const savedKey = process.env.GROQ_API_KEY
  const tmpAudio = path.join(os.tmpdir(), `media-tools-test-${Date.now()}.mp3`)

  beforeEach(async () => {
    delete process.env.GROQ_API_KEY
    await fsp.writeFile(tmpAudio, Buffer.from('fake mp3 bytes'))
  })
  afterEach(async () => { await fsp.unlink(tmpAudio).catch(() => {}) })
  afterAll(() => { if (savedKey !== undefined) process.env.GROQ_API_KEY = savedKey })

  test('reports transcription unavailable rather than throwing or fabricating a transcript', async () => {
    const result = await toolAudioProcess({ filepath: tmpAudio, action: 'transcribe' }, ctx)
    expect(result.ok).toBe(true) // ok:true because the tool call itself succeeded -- info was returned
    expect(result.result).toContain('Transcription failed')
    expect(result.result).not.toContain('Transcript:\n')
  })
})

describe('toolVideoProcess transcribe action', () => {
  const tmpVideo = path.join(os.tmpdir(), `media-tools-test-${Date.now()}.avi`)
  beforeEach(async () => { await fsp.writeFile(tmpVideo, Buffer.from('fake avi bytes')) })
  afterEach(async () => { await fsp.unlink(tmpVideo).catch(() => {}) })

  test('honestly reports unsupported containers (avi) rather than attempting a doomed transcription call', async () => {
    const result = await toolVideoProcess({ filepath: tmpVideo, action: 'transcribe' }, ctx)
    expect(result.ok).toBe(true)
    expect(result.result).toContain('not one Groq')
  })
})

describe('toolDirectoryList', () => {
  test('lists a real directory without error', async () => {
    const result = await toolDirectoryList({ dirpath: os.tmpdir() }, ctx)
    expect(result.ok).toBe(true)
  })
})
