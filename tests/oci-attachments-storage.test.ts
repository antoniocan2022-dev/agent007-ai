import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

describe('presignOciS3Url (pure signing, no network)', () => {
  const savedEnv = {
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    CHAT_ATTACHMENTS_S3_BUCKET: process.env.CHAT_ATTACHMENTS_S3_BUCKET,
    DR_BACKUP_S3_BUCKET: process.env.DR_BACKUP_S3_BUCKET,
    DR_BACKUP_S3_REGION: process.env.DR_BACKUP_S3_REGION,
    DR_BACKUP_S3_ENDPOINT: process.env.DR_BACKUP_S3_ENDPOINT,
  }

  beforeAll(() => {
    // Deterministic fake credentials -- this suite never makes a network call, it only
    // verifies the SigV4 URL construction is well-formed.
    process.env.AWS_ACCESS_KEY_ID = 'test-access-key'
    process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key'
    process.env.CHAT_ATTACHMENTS_S3_BUCKET = 'test-attachments-bucket'
    process.env.DR_BACKUP_S3_BUCKET = 'test-dr-bucket'
    process.env.DR_BACKUP_S3_REGION = 'ca-montreal-1'
    process.env.DR_BACKUP_S3_ENDPOINT = 'https://test-namespace.compat.objectstorage.ca-montreal-1.oci.customer-oci.com'
  })

  afterAll(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  test('CHAT_ATTACHMENTS_S3_BUCKET takes priority over DR_BACKUP_S3_BUCKET so attachments do not silently land in the immutable DR bucket once a dedicated bucket is configured', async () => {
    const { ociStorageConfig } = await import('../src/lib/oci-s3-signer')
    expect(ociStorageConfig().bucket).toBe('test-attachments-bucket')
  })

  test('falls back to DR_BACKUP_S3_BUCKET when no dedicated attachments bucket is configured, preserving existing behavior', async () => {
    delete process.env.CHAT_ATTACHMENTS_S3_BUCKET
    const { ociStorageConfig } = await import('../src/lib/oci-s3-signer')
    expect(ociStorageConfig().bucket).toBe('test-dr-bucket')
    process.env.CHAT_ATTACHMENTS_S3_BUCKET = 'test-attachments-bucket'
  })

  test('a presigned GET URL is well-formed: correct bucket/key path, SigV4 query params, and a bounded expiry', async () => {
    const { presignOciS3Url } = await import('../src/lib/oci-s3-signer')
    const url = new URL(presignOciS3Url({ method: 'GET', key: 'uploads/2026-01-01/user123-abc-file.pdf', expiresIn: 900 }))
    expect(url.pathname).toBe('/test-attachments-bucket/uploads/2026-01-01/user123-abc-file.pdf')
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
    expect(url.searchParams.get('X-Amz-Credential')).toStartWith('test-access-key/')
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900')
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
  })

  test('expiry is clamped to a sane maximum (604800s / 7 days) even if a caller asks for more', async () => {
    const { presignOciS3Url } = await import('../src/lib/oci-s3-signer')
    const url = new URL(presignOciS3Url({ method: 'GET', key: 'k', expiresIn: 999_999_999 }))
    expect(url.searchParams.get('X-Amz-Expires')).toBe('604800')
  })

  test('different HTTP methods and query params produce different signatures for the same key (no signature reuse across operations)', async () => {
    const { presignOciS3Url } = await import('../src/lib/oci-s3-signer')
    const getUrl = new URL(presignOciS3Url({ method: 'GET', key: 'k', expiresIn: 900 }))
    const putUrl = new URL(presignOciS3Url({ method: 'PUT', key: 'k', query: { partNumber: '1', uploadId: 'u1' }, expiresIn: 900 }))
    expect(getUrl.searchParams.get('X-Amz-Signature')).not.toBe(putUrl.searchParams.get('X-Amz-Signature'))
  })

  test('missing credentials fail closed with a clear error rather than silently signing with empty values', async () => {
    delete process.env.AWS_ACCESS_KEY_ID
    const { presignOciS3Url } = await import('../src/lib/oci-s3-signer')
    expect(() => presignOciS3Url({ method: 'GET', key: 'k' })).toThrow('OCI S3 storage credentials are not configured')
    process.env.AWS_ACCESS_KEY_ID = 'test-access-key'
  })
})

describe('OCI Object Storage live credential probe (real environment only)', () => {
  // This deliberately does NOT write, upload, or delete anything -- DR_BACKUP_S3_BUCKET (the
  // fallback attachments bucket) has a retention/immutability policy, so a write-then-cleanup
  // round trip here could leave permanently undeletable test objects in a DR-critical bucket.
  // Instead this presigns a GET for a key that is certain not to exist and expects OCI itself
  // to answer (404 Not Found), which only happens if the endpoint, region, and SigV4 signature
  // are all genuinely correct against the real deployed credentials. A 403 means the credentials
  // or signature are wrong; a network failure means the endpoint/region is wrong.
  const hasRealCredentials = !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && (process.env.CHAT_ATTACHMENTS_S3_BUCKET || process.env.DR_BACKUP_S3_BUCKET))

  test.skipIf(!hasRealCredentials)('a presigned GET for a nonexistent key reaches the real OCI endpoint and is correctly authenticated (404, not 403 or a network error)', async () => {
    const { presignOciS3Url } = await import('../src/lib/oci-s3-signer')
    const probeKey = `uploads/_attachment-credential-probe/${Date.now()}-${Math.random().toString(36).slice(2)}.nonexistent`
    const url = presignOciS3Url({ method: 'GET', key: probeKey, expiresIn: 60 })
    const response = await fetch(url, { method: 'GET' })
    expect(response.status).toBe(404)
  })
})
