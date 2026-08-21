import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { callLlmWithRetry } from '@/lib/agent'
import { getCanonicalProviderTelemetry, inferTaskType } from '@/lib/canonical-llm-router'
import { getSystemManifest, SYSTEM_MANIFEST_ID } from '@/lib/system-manifest'
import { validateProviderPriority } from '@/lib/provider-intelligence-policy'

const tsconfig = JSON.parse(readFileSync(new URL('../tsconfig.json', import.meta.url), 'utf8'))
const bridge = readFileSync(new URL('../src/lib/agent-canonical-bridge.ts', import.meta.url), 'utf8')

function walk(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) files.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(entry)) files.push(full)
  }
  return files
}

describe('Canonical runtime architecture', () => {
  test('the @/lib/agent import resolves through the governed bridge', () => {
    expect(tsconfig.compilerOptions.paths['@/lib/agent']).toEqual(['./src/lib/agent-canonical-bridge'])
    expect(bridge).toContain('runCanonicalLlm')
    expect(bridge).toContain("export * from './agent'")
    expect(typeof callLlmWithRetry).toBe('function')
  })

  test('runtime LLM transport does not directly import callLlmWithRetry from the legacy module', () => {
    const srcRoot = new URL('../src', import.meta.url).pathname
    const offenders = walk(srcRoot)
      .filter((file) => !file.endsWith('/src/lib/agent-canonical-bridge.ts'))
      .filter((file) => !file.endsWith('/src/lib/agent.ts'))
      .filter((file) => {
        const content = readFileSync(file, 'utf8')
        if (!content.includes('callLlmWithRetry')) return false
        return /(?:from\s+['"](?:\.\.\/|\.\/)*agent['"]|import\(['"](?:\.\.\/|\.\/)*agent['"]\))/.test(content)
      })
    expect(offenders).toEqual([])
  })

  test('provider governance has one canonical order', () => {
    expect(validateProviderPriority()).toEqual([])
    expect(getCanonicalProviderTelemetry().providerCount).toBe(4)
  })

  test('task inference is deterministic for high-risk CEO work', () => {
    expect(inferTaskType([{ role: 'user', content: 'review this financial investment decision' }])).toBe('financial')
    expect(inferTaskType([{ role: 'user', content: 'audit authentication security' }])).toBe('security')
    expect(inferTaskType([{ role: 'user', content: 'research Montreal competitors' }])).toBe('research')
  })

  test('system manifest uses the canonical identity and live provider inventory', () => {
    const manifest = getSystemManifest()
    expect(manifest.manifestId).toBe(SYSTEM_MANIFEST_ID)
    expect(manifest.capabilities.providerCount).toBe(4)
    expect(manifest.capabilities.toolCount).toBeGreaterThan(0)
    expect(manifest.organization.specialistCount).toBeGreaterThan(0)
  })
})
