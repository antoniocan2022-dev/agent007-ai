import { describe, expect, test } from 'bun:test'
import { ingestOciDocument, MAX_SYNCHRONOUS_INGEST_BYTES } from '@/lib/document-ingestion'

// These cover every validation branch that runs before ingestOciDocument makes any network or DB
// call (ownership check, size sanity, the synchronous-ingest cap) -- all fast, pure, and safe to run
// in any environment. The real download+extract+index round trip needs live OCI credentials and a
// database, exactly like tests/oci-attachments-storage.test.ts's live-credential probe; that path is
// exercised in CI, not here.

describe('ingestOciDocument input validation (no network/DB required)', () => {
  test('rejects a key that does not belong to the requesting user', async () => {
    const result = await ingestOciDocument({
      userId: 'user-a',
      key: 'uploads/2026-01-01/user-b-11111111-1111-1111-1111-111111111111-file.pdf',
      filename: 'file.pdf',
      mimeType: 'application/pdf',
      size: 1000,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('does not belong')
  })

  test('rejects a malformed key that does not match the expected upload-key shape at all', async () => {
    const result = await ingestOciDocument({
      userId: 'user-a',
      key: '../../etc/passwd',
      filename: 'file.pdf',
      mimeType: 'application/pdf',
      size: 1000,
    })
    expect(result.ok).toBe(false)
  })

  test('rejects a non-positive size', async () => {
    const result = await ingestOciDocument({
      userId: 'user-a',
      key: 'uploads/2026-01-01/user-a-11111111-1111-1111-1111-111111111111-file.pdf',
      filename: 'file.pdf',
      mimeType: 'application/pdf',
      size: 0,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Invalid file size')
  })

  test('rejects a file over MAX_SYNCHRONOUS_INGEST_BYTES with a clear, honest reason -- never attempts the download', async () => {
    const result = await ingestOciDocument({
      userId: 'user-a',
      key: 'uploads/2026-01-01/user-a-11111111-1111-1111-1111-111111111111-huge.zip',
      filename: 'huge.zip',
      mimeType: 'application/zip',
      size: MAX_SYNCHRONOUS_INGEST_BYTES + 1,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('stored')
      expect(result.error).toContain('not been analyzed')
    }
  })
})
