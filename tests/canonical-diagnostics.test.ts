import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('canonical LLM diagnostics', () => {
  test('uses the canonical provider runtime rather than the retired legacy router', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/api/system/diagnose-llm/route.ts'), 'utf8')
    expect(source).toContain("runCanonicalLlm")
    expect(source).toContain("getCanonicalProviderTelemetry")
    expect(source).not.toContain("callLlmWithRetry")
    expect(source).not.toContain("isFallbackConfigured")
  })
})
