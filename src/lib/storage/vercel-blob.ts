import type { ObjectStorageAdapter } from './object-storage'

function loadBlobHead(): ((pathname: string, options?: { token?: string }) => Promise<any>) | null {
  try {
    const dynamicRequire = new Function('id', 'return require(id)') as (id: string) => any
    const mod = dynamicRequire('@vercel/blob')
    return typeof mod?.head === 'function' ? mod.head : null
  } catch {
    return null
  }
}

export const vercelBlobAdapter: ObjectStorageAdapter = {
  provider: 'vercel-blob',
  isConfigured() {
    return !!process.env.BLOB_READ_WRITE_TOKEN && !!loadBlobHead()
  },
  async head(pathname) {
    const token = process.env.BLOB_READ_WRITE_TOKEN
    if (!token) return null
    const head = loadBlobHead()
    if (!head) return null
    const info = await head(pathname, { token })
    if (!info?.url) return null
    return {
      url: info.url,
      size: typeof info.size === 'number' ? info.size : undefined,
      contentType: typeof info.contentType === 'string' ? info.contentType : undefined,
    }
  },
}
