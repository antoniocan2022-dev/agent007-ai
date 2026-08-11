import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { generateDownloadToken } from './product-fulfillment'

describe('product fulfillment security', () => {
  test('generates cryptographically strong URL-safe tokens', () => {
    const tokens = Array.from({ length: 100 }, () => generateDownloadToken())
    expect(new Set(tokens).size).toBe(tokens.length)
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    }
  })

  test('does not retain historical host fallback or Math.random token generation', () => {
    const source = readFileSync(new URL('./product-fulfillment.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('agent007-ai.vercel.app')
    expect(source).not.toContain('Math.random()')
    expect(source).toContain('randomBytes(32)')
    expect(source).toContain('getPublicBaseUrl()')
  })

  test('fulfillment token contract contains checkout-session identity', () => {
    const source = readFileSync(new URL('./product-fulfillment.ts', import.meta.url), 'utf8')
    expect(source).toContain('checkoutSessionId')
    expect(source).toContain('ownerUserId')
    expect(source).toContain('userId_key')
  })
})
