import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getPublicBaseUrl } from './public-base-url'
import { getObjectStorageAdapter, registerObjectStorageAdapter } from '../storage/object-storage'

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

describe('Hosting Independence v1', () => {
  test('public URL resolver has no Vercel fallback', () => {
    const source = read('src/lib/runtime/public-base-url.ts')
    expect(source).not.toContain('VERCEL_URL')
    expect(source).not.toContain('agent007-ai.vercel.app')
  })

  test('core download and checkout routes do not import hosting SDKs', () => {
    for (const path of ['src/app/api/file-download/route.ts', 'src/app/api/checkout/route.ts']) {
      const source = read(path)
      expect(source).not.toContain('@vercel/functions')
      expect(source).not.toContain('@vercel/blob')
      expect(source).not.toContain('VERCEL_URL')
      expect(source).not.toContain('agent007-ai.vercel.app')
    }
  })

  test('Vercel implementation is isolated to explicit adapters', () => {
    const background = read('src/lib/runtime/vercel-background.ts')
    const storage = read('src/lib/storage/vercel-blob.ts')
    expect(background).toContain('vercel')
    expect(storage).toContain('@vercel/blob')

    const instrumentation = read('instrumentation.ts')
    expect(instrumentation).toContain('registerVercelBackgroundRuntime')
    expect(instrumentation).toContain('registerObjectStorageAdapter')
  })

  test('storage registry is host-neutral and prevents conflicting adapters', () => {
    const existing = getObjectStorageAdapter()
    const adapter = {
      provider: `test-${Date.now()}`,
      isConfigured: () => true,
      head: async () => ({ url: 'https://storage.example/file' }),
    }
    if (!existing) registerObjectStorageAdapter(adapter)
    expect(getObjectStorageAdapter()).not.toBeNull()
    if (!existing) expect(() => registerObjectStorageAdapter({ ...adapter, provider: 'another' })).toThrow()
  })

  test('production public URL fails closed without configuration', () => {
    const originalNodeEnv = process.env.NODE_ENV
    const originalPublicUrl = process.env.PUBLIC_APP_URL
    const originalNextAuthUrl = process.env.NEXTAUTH_URL
    try {
      process.env.NODE_ENV = 'production'
      delete process.env.PUBLIC_APP_URL
      delete process.env.NEXTAUTH_URL
      expect(() => getPublicBaseUrl()).toThrow()
    } finally {
      process.env.NODE_ENV = originalNodeEnv
      if (originalPublicUrl === undefined) delete process.env.PUBLIC_APP_URL
      else process.env.PUBLIC_APP_URL = originalPublicUrl
      if (originalNextAuthUrl === undefined) delete process.env.NEXTAUTH_URL
      else process.env.NEXTAUTH_URL = originalNextAuthUrl
    }
  })
})
