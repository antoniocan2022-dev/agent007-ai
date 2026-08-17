import { createHash, createHmac } from 'node:crypto'

export interface ObjectStorageConfig {
  endpoint: string
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle: boolean
}

export interface MultipartPart { partNumber: number; etag: string; size?: number }

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required object-storage configuration: ${name}`)
  return value
}

export function getObjectStorageConfig(): ObjectStorageConfig {
  const endpoint = required('ATTACHMENT_S3_ENDPOINT').replace(/\/+$/, '')
  return {
    endpoint,
    bucket: required('ATTACHMENT_S3_BUCKET'),
    region: process.env.ATTACHMENT_S3_REGION?.trim() || 'us-east-1',
    accessKeyId: required('ATTACHMENT_S3_ACCESS_KEY_ID'),
    secretAccessKey: required('ATTACHMENT_S3_SECRET_ACCESS_KEY'),
    forcePathStyle: process.env.ATTACHMENT_S3_FORCE_PATH_STYLE !== 'false',
  }
}

const encoder = new TextEncoder()
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const hmac = (key: Uint8Array | string, value: string) => createHmac('sha256', key).update(value).digest()
const awsEncode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)

function canonicalUri(config: ObjectStorageConfig, key: string): string {
  const encodedKey = key.split('/').map(awsEncode).join('/')
  if (config.forcePathStyle) return `/${awsEncode(config.bucket)}/${encodedKey}`
  return `/${encodedKey}`
}

function requestUrl(config: ObjectStorageConfig, key: string): URL {
  const base = new URL(config.endpoint)
  const encodedPath = key.split('/').map(encodeURIComponent).join('/')
  if (config.forcePathStyle) {
    base.pathname = `${base.pathname.replace(/\/$/, '')}/${encodeURIComponent(config.bucket)}/${encodedPath}`
  } else {
    base.hostname = `${config.bucket}.${base.hostname}`
    base.pathname = `${base.pathname.replace(/\/$/, '')}/${encodedPath}`
  }
  return base
}

function canonicalQuery(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => [awsEncode(k), awsEncode(v)] as const)
    .sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
}

function canonicalHeaders(headers: Record<string, string>): { canonical: string; signed: string } {
  const entries = Object.entries(headers).map(([k, v]) => [k.toLowerCase().trim(), v.trim().replace(/\s+/g, ' ')] as const).sort(([a], [b]) => a.localeCompare(b))
  return {
    canonical: entries.map(([k, v]) => `${k}:${v}\n`).join(''),
    signed: entries.map(([k]) => k).join(';'),
  }
}

function signingKey(secret: string, dateStamp: string, region: string, service = 's3') {
  const kDate = hmac(encoder.encode(`AWS4${secret}`), dateStamp)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, service)
  return hmac(kService, 'aws4_request')
}

function isoNow() { return new Date().toISOString().replace(/[:-]|\.\d{3}/g, '') }

async function signedRequest(input: { method: string; key: string; query?: Record<string, string>; body?: string; contentType?: string; responseType?: 'text' | 'empty' }) {
  const config = getObjectStorageConfig()
  const url = requestUrl(config, input.key)
  const amzDate = isoNow()
  const dateStamp = amzDate.slice(0, 8)
  const host = url.host
  const payload = input.body ?? ''
  const payloadHash = sha256(payload)
  const headers: Record<string, string> = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate }
  if (input.contentType) headers['content-type'] = input.contentType
  const { canonical, signed } = canonicalHeaders(headers)
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`
  const params = input.query ?? {}
  const canonicalRequest = [input.method.toUpperCase(), canonicalUri(config, input.key), canonicalQuery(params), canonical, signed, payloadHash].join('\n')
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256(canonicalRequest)].join('\n')
  const signature = createHmac('sha256', signingKey(config.secretAccessKey, dateStamp, config.region)).update(stringToSign).digest('hex')
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signed}, Signature=${signature}`
  const response = await fetch(`${url.origin}${requestUrl(config, input.key).pathname}${params && Object.keys(params).length ? `?${canonicalQuery(params)}` : ''}`, {
    method: input.method,
    headers: { ...headers, authorization },
    body: input.method === 'GET' || input.method === 'HEAD' || input.method === 'DELETE' ? undefined : payload,
    redirect: 'follow',
    signal: AbortSignal.timeout(60_000),
  })
  const text = input.responseType === 'empty' ? '' : await response.text()
  if (!response.ok) throw new Error(`Object storage ${input.method} ${response.status}: ${text.slice(0, 500)}`)
  return { response, text }
}

function parseUploadId(xml: string): string {
  const match = xml.match(/<UploadId>([^<]+)<\/UploadId>/i)
  if (!match) throw new Error('Object storage did not return a multipart upload id.')
  return match[1]
}

function parseCompleteEtag(xml: string): string | null { return xml.match(/<ETag>\"?([^<\"]+)\"?<\/ETag>/i)?.[1] ?? null }

export async function createMultipartUpload(key: string, contentType: string): Promise<string> {
  const { text } = await signedRequest({ method: 'POST', key, query: { uploads: '' }, body: '', contentType, responseType: 'text' })
  return parseUploadId(text)
}

export async function completeMultipartUpload(key: string, uploadId: string, parts: MultipartPart[]): Promise<string | null> {
  if (!parts.length) throw new Error('At least one multipart part is required.')
  const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber)
  for (let i = 0; i < ordered.length; i++) if (ordered[i].partNumber !== i + 1 || !ordered[i].etag) throw new Error('Multipart parts must be contiguous and have ETags.')
  const body = `<?xml version="1.0" encoding="UTF-8"?><CompleteMultipartUpload>${ordered.map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${escapeXml(p.etag)}</ETag></Part>`).join('')}</CompleteMultipartUpload>`
  const { text } = await signedRequest({ method: 'POST', key, query: { uploadId }, body, contentType: 'application/xml', responseType: 'text' })
  return parseCompleteEtag(text)
}

export async function abortMultipartUpload(key: string, uploadId: string): Promise<void> { await signedRequest({ method: 'DELETE', key, query: { uploadId }, responseType: 'empty' }) }

export async function headObject(key: string): Promise<{ size: number; etag: string | null; contentType: string | null }> {
  const { response } = await signedRequest({ method: 'HEAD', key, responseType: 'empty' })
  return { size: Number(response.headers.get('content-length') ?? 0), etag: response.headers.get('etag'), contentType: response.headers.get('content-type') }
}

export async function listMultipartParts(key: string, uploadId: string): Promise<MultipartPart[]> {
  const { text } = await signedRequest({ method: 'GET', key, query: { uploadId }, responseType: 'text' })
  const parts: MultipartPart[] = []
  const regex = /<Part>\s*<PartNumber>(\d+)<\/PartNumber>\s*<LastModified>[^<]*<\/LastModified>\s*<ETag>\"?([^<\"]+)\"?<\/ETag>\s*<Size>(\d+)<\/Size>\s*<\/Part>/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(text))) parts.push({ partNumber: Number(match[1]), etag: match[2], size: Number(match[3]) })
  return parts
}

export function presignObjectPart(method: 'PUT' | 'GET', key: string, extraQuery: Record<string, string>, expiresSeconds = 900): string {
  const config = getObjectStorageConfig()
  const url = requestUrl(config, key)
  const amzDate = isoNow()
  const dateStamp = amzDate.slice(0, 8)
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`
  const host = url.host
  const params: Record<string, string> = {
    ...extraQuery,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${config.accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(Math.min(Math.max(Math.floor(expiresSeconds), 1), 3600)),
    'X-Amz-SignedHeaders': 'host',
  }
  const canonicalRequest = [method, canonicalUri(config, key), canonicalQuery(params), `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n')
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256(canonicalRequest)].join('\n')
  params['X-Amz-Signature'] = createHmac('sha256', signingKey(config.secretAccessKey, dateStamp, config.region)).update(stringToSign).digest('hex')
  return `${url.origin}${url.pathname}?${canonicalQuery(params)}`
}

function escapeXml(value: string): string { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&apos;') }
