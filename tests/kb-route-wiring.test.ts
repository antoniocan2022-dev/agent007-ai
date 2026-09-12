import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')

// Post-merge audit fix (2026-09-12): /api/kb's small-file upload path previously had no audio/video
// branch at all -- a small audio/video file fell through to the generic binary fallback and had its
// raw bytes decoded as utf-8 "text" (garbage), which then got chunked and indexed into the knowledge
// base. This locks in that both KB upload entry points (the small-file path here, and the OCI
// ingest-remote path) use the same shared transcription helper, so they can't silently drift back
// out of sync the way media-tools.ts's audio tool and this route once had.
describe('/api/kb small-file upload route wiring', () => {
  const source = readFileSync(join(ROOT, 'src/app/api/kb/route.ts'), 'utf-8')

  test('imports the shared transcription helper rather than leaving audio/video unhandled', () => {
    expect(source).toContain("import { transcribeAudioOrVideo, isTranscribableExtension } from '@/lib/media-transcription'")
  })

  test('routes audio/video mime types (or a transcribable extension) through transcribeAudioOrVideo before falling back to the generic binary branch', () => {
    expect(source).toMatch(/mimeType\.startsWith\('audio\/'\)\s*\|\|\s*mimeType\.startsWith\('video\/'\)\s*\|\|\s*isTranscribableExtension\(path\.extname\(filename\)\)/)
    expect(source).toContain('await transcribeAudioOrVideo(buffer, filename)')
  })

  test('uses path.extname (empty string for no extension) rather than a fragile manual slice', () => {
    expect(source).toContain('path.extname(filename)')
    expect(source).not.toContain("filename.slice(filename.lastIndexOf('.'))")
  })
})
