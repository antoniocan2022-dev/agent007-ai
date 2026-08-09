export interface OciUploadProgress {
  uploadedBytes: number
  totalBytes: number
  completedParts: number
  totalParts: number
  percent: number
}

export interface OciUploadResult {
  bucket: string
  key: string
  uploadId: string
  size: number
}

const MAX_RETRIES = 4
const CONCURRENCY = 4

async function api(body: Record<string, unknown>) {
  const response = await fetch('/api/storage/multipart', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data?.error || `Storage API failed (${response.status})`)
  return data
}

async function uploadPart(file: File, partNumber: number, partSize: number, key: string, uploadId: string) {
  const start = (partNumber - 1) * partSize
  const end = Math.min(file.size, start + partSize)
  const body = file.slice(start, end)
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { url } = await api({ action: 'presign-part', key, uploadId, partNumber })
      const response = await fetch(url, { method: 'PUT', body })
      if (!response.ok) throw new Error(`Part ${partNumber} upload failed (${response.status})`)
      const etag = response.headers.get('etag')
      if (!etag) throw new Error(`Part ${partNumber} completed without an ETag`)
      return { partNumber, etag: etag.replace(/^"|"$/g, ''), size: end - start }
    } catch (error) {
      if (attempt === MAX_RETRIES) throw error
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt))
    }
  }
  throw new Error(`Part ${partNumber} failed`)
}

export async function uploadLargeFile(
  file: File,
  onProgress?: (progress: OciUploadProgress) => void,
): Promise<OciUploadResult> {
  const init = await api({
    action: 'initiate',
    name: file.name,
    size: file.size,
    contentType: file.type || 'application/octet-stream',
  })

  const completed: Array<{ partNumber: number; etag: string; size: number }> = []
  let nextPart = 1
  let uploadedBytes = 0
  let aborted = false

  const worker = async () => {
    while (!aborted) {
      const partNumber = nextPart++
      if (partNumber > init.totalParts) return
      const part = await uploadPart(file, partNumber, init.partSize, init.key, init.uploadId)
      completed.push(part)
      uploadedBytes += part.size
      onProgress?.({
        uploadedBytes,
        totalBytes: file.size,
        completedParts: completed.length,
        totalParts: init.totalParts,
        percent: Math.round((uploadedBytes / file.size) * 1000) / 10,
      })
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, init.totalParts) }, () => worker()))
    completed.sort((a, b) => a.partNumber - b.partNumber)
    await api({
      action: 'complete',
      key: init.key,
      uploadId: init.uploadId,
      parts: completed.map(({ partNumber, etag }) => ({ partNumber, etag })),
    })
    return { bucket: init.bucket, key: init.key, uploadId: init.uploadId, size: file.size }
  } catch (error) {
    aborted = true
    try {
      await api({ action: 'abort', key: init.key, uploadId: init.uploadId })
    } catch {
      // Preserve the original upload error; an orphaned multipart upload is cleaned up by OCI retention policy.
    }
    throw error
  }
}
