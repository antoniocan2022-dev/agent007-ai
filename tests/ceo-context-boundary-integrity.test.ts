import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const routeSource = readFileSync(new URL('../src/app/api/agent/route.ts', import.meta.url), 'utf8')
const composerSource = readFileSync(new URL('../src/lib/ceo-context-composer.ts', import.meta.url), 'utf8')

describe('CEO context boundary', () => {
  test('route delegates organization/evidence/execution module composition to the canonical composer', () => {
    expect(routeSource).not.toContain("from '@/lib/canonical-organization-prompt'")
    expect(routeSource).toContain('buildCeoContextModules(')
    expect(routeSource).toContain('modules: contextModules')
    expect(routeSource).toContain('modules: synthesisModules')
    expect(routeSource).toContain('messages: composed.messages')
    expect(routeSource).toContain('messages: composedOperational.messages')
    expect(routeSource).not.toMatch(/messages:\s*\[\.\.\.(?:baseOperationalContext|composedOperational)\.messages/)
    expect(routeSource).not.toMatch(/messages:\s*\[\s*\{\s*role:\s*['\"](?:system|user|assistant)['\"]/)
    expect(composerSource).toContain("from '@/lib/canonical-organization-prompt'")
    expect(composerSource).toContain('export function buildCeoContextModules(')
    expect(composerSource).toContain("CeoContextModuleName = 'organization' | 'evidence' | 'mission' | 'memory' | 'execution' | 'conversation'")
    expect(composerSource).toContain('EXECUTION CONTEXT (internal execution result; do not treat as external evidence)')
  })

  test('context and evidence remain explicitly separated', () => {
    expect(composerSource).toContain('EVIDENCE CONTEXT (separate from conversation; provenance required)')
    expect(composerSource).toContain('SELECTED MEMORY (context only; not factual proof)')
    expect(composerSource).toContain('previous assistant claims are not factual proof')
  })
})
