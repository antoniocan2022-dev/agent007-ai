// Real ingestion pipeline for knowledge-base documents that arrive via the existing 10GB OCI
// large-upload path (oci-large-upload.ts / AttachmentMeta.remote), rather than the small inline
// uploads /api/kb/route.ts already handled directly. Before this, a large attachment's content was
// never read at all -- attachmentContextSuffix in agent.ts honestly tells the CEO so. This gives
// those files a real (bounded) path into the same KnowledgeChunk/KnowledgeDoc tables the small-file
// upload path uses, so they become searchable via knowledge-base.ts's searchKnowledgeBase.
//
// "Chunked, streamed" here means: the object is downloaded from OCI's presigned URL as a stream and
// written straight to a bounded-lifetime temp file, never buffered whole in memory -- the same
// integrity discipline (checksum verification, size checks) the upload path already applies. It is
// deliberately NOT a claim that a full 10GB file can be parsed inline within one HTTP request: a
// serverless function has a real, finite execution-time budget, and pretending otherwise would be
// exactly the kind of overclaiming this pass also fixed in media-tools.ts. MAX_SYNCHRONOUS_INGEST_BYTES
// is the honest ceiling for what this pipeline processes today; a file over that limit gets a clear
// error explaining it is stored but not analyzed, never a silent failure or a fabricated summary.

import { createWriteStream, promises as fsp } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { db } from '@/lib/db'
import { presignOciS3Url, isOwnedUploadKey } from './oci-s3-signer'
import { extractDocumentText } from './document-parsers'
import { transcribeAudioOrVideo, isTranscribableExtension, MAX_TRANSCRIPTION_BYTES } from './media-transcription'
import { indexDocument } from './knowledge-base'

// Real, but bounded: high enough to cover the large majority of real-world documents/recordings,
// low enough to plausibly complete (download + extraction + chunking + embeddings) within a
// serverless function's execution budget. Files above this remain in OCI storage, verified and
// retrievable, just not yet analyzed -- see the honest error this returns rather than timing out.
export const MAX_SYNCHRONOUS_INGEST_BYTES = 200 * 1024 * 1024

const TEXT_LIKE_EXTENSION_RE = /\.(txt|md|json|csv|js|ts|tsx|jsx|py|go|rs|java|c|cpp|h|sh|sql|yaml|yml|xml|html|css)$/i

function isTextLike(filename: string, mimeType: string): boolean {
  return mimeType === 'text/plain' || mimeType === 'text/markdown' || mimeType === 'application/json' || mimeType === 'text/csv' || TEXT_LIKE_EXTENSION_RE.test(filename)
}

export interface RemoteIngestInput {
  userId: string
  key: string
  filename: string
  mimeType: string
  size: number
  checksum?: { algorithm: string; value: string }
}

export type RemoteIngestResult =
  | { ok: true; docId: string; filename: string; chunkCount: number; size: number; extractionMethod: string; warning?: string }
  | { ok: false; error: string }

// Post-merge audit fix (2026-09-12): confirms the OCI object's real size matches what the caller
// declared BEFORE spending any download bandwidth on it. Without this, a caller could declare a
// small size (passing the cheap upfront cap check in ingestOciDocument) while pointing at an
// object that is actually far larger -- the old code would still stream up to
// MAX_SYNCHRONOUS_INGEST_BYTES before its mid-download check caught the lie, wasting real bandwidth
// and time on a request that was always going to fail. A HEAD request is a few bytes and settles
// this before the GET ever starts.
async function verifyRemoteObjectSize(key: string, expectedSize: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = presignOciS3Url({ method: 'HEAD', key, expiresIn: 900 })
  const response = await fetch(url, { method: 'HEAD', cache: 'no-store' })
  if (!response.ok) return { ok: false, error: `Failed to verify the stored object before download (HTTP ${response.status}).` }
  const actualSize = Number(response.headers.get('content-length'))
  if (!Number.isSafeInteger(actualSize) || actualSize !== expectedSize) {
    return { ok: false, error: `Declared size (${expectedSize} bytes) does not match the stored object's actual size (${Number.isFinite(actualSize) ? actualSize : 'unknown'} bytes).` }
  }
  return { ok: true }
}

async function streamDownloadToFile(key: string, destPath: string, expectedSize: number, checksum: { algorithm: string; value: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = presignOciS3Url({ method: 'GET', key, expiresIn: 900 })
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok || !response.body) return { ok: false, error: `Failed to download object from storage (HTTP ${response.status}).` }

  const hashAlgorithm = checksum.algorithm.toUpperCase() === 'MD5' ? 'md5' : 'sha256'
  const hash = crypto.createHash(hashAlgorithm)
  let bytesWritten = 0
  const writeStream = createWriteStream(destPath)
  // Post-merge audit fix (2026-09-12): fs write streams emit 'error' asynchronously (e.g. ENOSPC,
  // EACCES on the temp directory) independently of any pending write() callback. With no listener
  // registered, Node treats an unhandled 'error' event as an uncaught exception and crashes the
  // process -- a full request-handler crash from something as ordinary as a full /tmp. Recording it
  // here and checking it in the read loop turns that into the same clean {ok:false} this function
  // already returns for every other failure mode.
  let streamError: Error | null = null
  writeStream.on('error', (err) => { streamError = err })
  const reader = response.body.getReader()
  try {
    while (true) {
      if (streamError) throw streamError
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      bytesWritten += value.byteLength
      // Checked against the caller's declared size, not the global cap -- verifyRemoteObjectSize
      // already confirmed the two match before this download started, so exceeding it here means
      // the object changed underneath us (a same-key re-upload race) rather than a merely-large file.
      if (bytesWritten > expectedSize) {
        throw new Error(`Downloaded more than the verified ${expectedSize}-byte object size -- the stored object may have changed during download.`)
      }
      hash.update(value)
      const chunk = Buffer.from(value)
      await new Promise<void>((resolve, reject) => { writeStream.write(chunk, (err) => (err ? reject(err) : resolve())) })
    }
  } catch (error: any) {
    await new Promise<void>((resolve) => writeStream.end(resolve))
    return { ok: false, error: error?.message ?? String(error) }
  }
  await new Promise<void>((resolve) => writeStream.end(resolve))
  if (streamError) return { ok: false, error: (streamError as Error).message }

  if (bytesWritten !== expectedSize) {
    return { ok: false, error: `Downloaded ${bytesWritten} bytes but the verified upload was ${expectedSize} bytes.` }
  }
  const actual = hash.digest('hex')
  if (actual.toLowerCase() !== checksum.value.toLowerCase()) {
    return { ok: false, error: 'Checksum mismatch -- downloaded content does not match the verified upload.' }
  }
  return { ok: true }
}

/**
 * Downloads an OCI-stored attachment (already uploaded and verified via oci-large-upload.ts),
 * extracts its text with the right method for its format, and indexes it into the same
 * KnowledgeChunk/KnowledgeDoc tables /api/kb/route.ts's small-file path uses. Every failure mode
 * (ownership mismatch, oversize, unsupported format, extraction failure, transcription failure)
 * returns a clear `{ ok: false, error }` rather than throwing into a caller that might not expect it.
 */
export async function ingestOciDocument(input: RemoteIngestInput): Promise<RemoteIngestResult> {
  const { userId, key, filename, mimeType } = input
  if (!isOwnedUploadKey(key, userId)) return { ok: false, error: 'This storage key does not belong to the requesting user.' }
  if (!Number.isSafeInteger(input.size) || input.size <= 0) return { ok: false, error: 'Invalid file size.' }
  if (input.size > MAX_SYNCHRONOUS_INGEST_BYTES) {
    return { ok: false, error: `File is ${Math.round(input.size / 1024 / 1024)}MB, over the ${Math.round(MAX_SYNCHRONOUS_INGEST_BYTES / 1024 / 1024)}MB limit this pipeline can ingest synchronously today. It remains stored in full but has not been analyzed.` }
  }
  // Post-merge audit fix (2026-09-12): this module's own docstring claims the download is
  // "checksum-verified against the original upload" -- that was only true when a caller happened to
  // supply one, since streamDownloadToFile silently skipped verification otherwise. The real upload
  // flow (oci-large-upload.ts's uploadLargeFile) always returns a verified checksum on success, so a
  // legitimate caller always has one to pass; requiring it here closes the silent-skip gap rather
  // than leaving content integrity as an optional extra.
  if (!input.checksum?.value) return { ok: false, error: 'A checksum is required to verify ingestion against the original upload.' }
  const checksum = input.checksum

  const sizeVerification = await verifyRemoteObjectSize(key, input.size)
  if (!sizeVerification.ok) return sizeVerification

  const tmpPath = path.join(os.tmpdir(), `kb-ingest-${crypto.randomUUID()}`)
  try {
    const downloaded = await streamDownloadToFile(key, tmpPath, input.size, checksum)
    if (!downloaded.ok) return downloaded

    const ext = path.extname(filename).toLowerCase()
    let text = ''
    let extractionMethod = 'text'
    let warning: string | undefined

    if (isTextLike(filename, mimeType)) {
      text = await fsp.readFile(tmpPath, 'utf-8')
    } else if (mimeType.startsWith('audio/') || mimeType.startsWith('video/') || isTranscribableExtension(ext)) {
      if (!isTranscribableExtension(ext)) {
        return { ok: false, error: `${ext || mimeType} is not a container this runtime can transcribe (no ffmpeg/transcoding toolchain available). Supported: mp3, wav, ogg, flac, m4a, mp4, webm, mpeg, mpga.` }
      }
      const stat = await fsp.stat(tmpPath)
      if (stat.size > MAX_TRANSCRIPTION_BYTES) {
        return { ok: false, error: `Audio/video is ${Math.round(stat.size / 1024 / 1024)}MB, over the ${Math.round(MAX_TRANSCRIPTION_BYTES / 1024 / 1024)}MB transcription request limit.` }
      }
      const buffer = await fsp.readFile(tmpPath)
      const transcription = await transcribeAudioOrVideo(buffer, filename)
      if (!transcription.ok) return { ok: false, error: transcription.error }
      text = transcription.text
      extractionMethod = 'transcription'
    } else {
      const buffer = await fsp.readFile(tmpPath)
      const parsed = extractDocumentText(buffer, filename, mimeType)
      if (!parsed) return { ok: false, error: `Unsupported file type for ingestion: ${mimeType || ext || 'unknown'}. Text, PDF, DOCX, XLSX, PPTX, and transcribable audio/video are supported.` }
      text = parsed.text
      extractionMethod = parsed.method
      warning = parsed.warning
    }

    if (!text.trim()) return { ok: false, error: warning ?? 'No text could be extracted from this file.' }

    const doc = await db.knowledgeDoc.create({
      data: { userId, filename, mimeType, size: input.size, text: text.slice(0, 500_000), chunkCount: 0 },
    })
    const chunkCount = await indexDocument(userId, doc.id, text)

    return { ok: true, docId: doc.id, filename, chunkCount, size: input.size, extractionMethod, warning }
  } finally {
    await fsp.unlink(tmpPath).catch(() => {})
  }
}
