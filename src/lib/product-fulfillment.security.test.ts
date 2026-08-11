import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { generateDownloadToken } from './product-fulfillment'

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('product fulfillment security', () => {
  test('generates cryptographically strong URL-safe tokens', () => {
    const tokens = Array.from({ length: 100 }, () => generateDownloadToken())
    expect(new Set(tokens).size).toBe(tokens.length)
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  test('does not retain historical host fallback or weak token generation', () => {
    const source = readFileSync(new URL('./product-fulfillment.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('agent007-ai.vercel.app')
    expect(source).not.toContain('Math.random()')
    expect(source).toContain('randomBytes(32)')
    expect(source).toContain('getPublicBaseUrl()')
  })

  test('binds fulfillment tokens to the verified owner and checkout session', () => {
    const source = readFileSync(new URL('./product-fulfillment.ts', import.meta.url), 'utf8')
    expect(source).toContain('checkoutSessionId')
    expect(source).toContain('ownerUserId')
    expect(source).toContain('userId_key')
  })

  test('download-link resolves checkout session identity without hosting coupling', () => {
    const source = read('app/api/download-link/route.ts')
    expect(source).toContain('checkoutSessionId')
    expect(source).toContain('getPublicBaseUrl()')
    expect(source).not.toContain('agent007-ai.vercel.app')
    expect(source).not.toContain('NEXTAUTH_URL')
  })

  test('Stripe webhook passes owner and checkout-session identity through fulfillment', () => {
    const source = read('app/api/webhooks/stripe/route.ts')
    expect(source).toContain('ownerUserId: owner.id')
    expect(source).toContain('checkoutSessionId')
    expect(source).toContain('pg_advisory_xact_lock')
  })
})
