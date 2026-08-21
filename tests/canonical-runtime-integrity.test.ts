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

// These pre-existing compatibility modules still depend on the legacy agent
// transport for behavior not yet migrated to the canonical router. Keep this
// boundary explicit so the gate prevents NEW legacy call sites while allowing
// the audited migration surface to remain stable.
const LEGACY_COMPATIBILITY_FILES = new Set([
  'multi-provider-comparison.ts',
  'leader-debate.ts',
  'super-agent-verifier.ts',
  'mission-os.ts',
  'orchestrator.ts',
  'predicted-iq.ts',
  'business-portfolio.ts',
  'self-healing-engine.ts',
  'real-intelligence-tools.ts',
  'mission-pipeline.ts',
  'cognitive-framework.ts',
  'evolution-engine.ts',
  'performance-booster-tools.ts',
])

describe('Canonical runtime architecture', () => {
  test('the @/lib/agent import resolves through the governed bridge', () => {
    expect(tsconfig.compilerOptions.paths['@/lib/agent']).toEqual(['./src/lib/agent-canonical-bridge'])
    expect(bridge).toContain('runCanonicalLlm')
    expect(bridge).toContain("export * from './agent'")
    expect(typeof callLlmWithRetry).toBe('function')
  })

  test('new runtime code does not introduce additional direct legacy LLM transport calls', () => {
    const srcRoot = new URL('../src', import.meta.url).pathname
    const offenders = walk(srcRoot)
      .filter((file) => !file.endsWith('/src/lib/agent-canonical-bridge.ts'))
      .filter((file) => !file.endsWith('/src/lib/agent.ts'))
      .filter((file) => !LEGACY_COMPATIBILITY_FILES.has(file.split('/').pop() ?? ''))
      .filter((file) => {
        const content = readFileSync(file, 'utf8')
        return /\bcallLlmWithRetry\s*\(/.test(content)
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
