export interface ObjectStorageAdapter {
  readonly provider: string
  isConfigured(): boolean
  head(pathname: string): Promise<{ url: string; size?: number; contentType?: string } | null>
}

let adapter: ObjectStorageAdapter | null = null

export function registerObjectStorageAdapter(next: ObjectStorageAdapter): void {
  if (adapter && adapter.provider !== next.provider) {
    throw new Error(`Object storage adapter already registered: ${adapter.provider}`)
  }
  adapter = next
}

export function getObjectStorageAdapter(): ObjectStorageAdapter | null {
  return adapter
}

export function hasObjectStorageAdapter(): boolean {
  return !!adapter?.isConfigured()
}
