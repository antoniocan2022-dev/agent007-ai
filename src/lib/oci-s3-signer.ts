import { createHmac, createHash } from 'node:crypto'

const ALGORITHM = 'AWS4-HMAC-SHA256'
const SERVICE = 's3'
const DEFAULT_EXPIRY_SECONDS = 900

function hmac(key: Buffer | string, data: string) {
  return createHmac('sha256', key).update(data).digest()
}

function sha256(data: string) {
  return createHash('sha256').update(data).digest('hex')
}

function awsEncode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

function canonicalQuery(params: Record<string, string>) {
  return Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${awsEncode(k)}=${awsEncode(v)}`)
    .join('&')
}

function canonicalUri(key: string) {
  return `/${key.split('/').map(awsEncode).join('/')}`
}

function getConfig() {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY
  const bucket = process.env.DR_BACKUP_S3_BUCKET
  const region = process.env.DR_BACKUP_S3_REGION || 'ca-montreal-1'
  const endpoint = process.env.DR_BACKUP_S3_ENDPOINT || `https://${process.env.DR_BACKUP_S3_NAMESPACE || 'axpyeqhqzuof'}.compat.objectstorage.${region}.oci.customer-oci.com`

  if (!accessKeyId || !secretAccessKey || !bucket) {
    throw new Error('OCI S3 storage credentials are not configured')
  }

  return { accessKeyId, secretAccessKey, bucket, region, endpoint: endpoint.replace(/\/$/, '') }
}

function signingKey(secret: string, date: string, region: string) {
  const kDate = hmac(`AWS4${secret}`, date)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, SERVICE)
  return hmac(kService, 'aws4_request')
}

export function ociStorageConfig() {
  return getConfig()
}

export function presignOciS3Url({
  method,
  key,
  query = {},
  expiresIn = DEFAULT_EXPIRY_SECONDS,
}: {
  method: 'GET' | 'PUT' | 'POST' | 'DELETE'
  key: string
  query?: Record<string, string>
  expiresIn?: number
}) {
  const { accessKeyId, secretAccessKey, bucket, region, endpoint } = getConfig()
  const url = new URL(`${endpoint}/${awsEncode(bucket)}${canonicalUri(key)}`)
  const host = url.host
  const now = new Date()
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const date = amzDate.slice(0, 8)
  const credentialScope = `${date}/${region}/${SERVICE}/aws4_request`
  const params: Record<string, string> = {
    ...query,
    'X-Amz-Algorithm': ALGORITHM,
    'X-Amz-Credential': `${accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(Math.min(604800, Math.max(1, expiresIn))),
    'X-Amz-SignedHeaders': 'host',
  }
  const canonicalHeaders = `host:${host}\n`
  const signedHeaders = 'host'
  const canonicalRequest = [
    method,
    url.pathname,
    canonicalQuery(params),
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n')
  const signature = createHmac('sha256', signingKey(secretAccessKey, date, region))
    .update(`${ALGORITHM}\n${amzDate}\n${credentialScope}\n${sha256(canonicalRequest)}`)
    .digest('hex')

  params['X-Amz-Signature'] = signature
  url.search = canonicalQuery(params)
  return url.toString()
}
