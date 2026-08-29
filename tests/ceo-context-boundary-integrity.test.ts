import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const routeSource = readFileSync(new URL('../src/app/api/agent/route.ts', import.meta.url), 'utf8')
const composerSource = readFileSync(new URL('../src/lib/ceo-context-composer.ts', import.meta.url), 'utf8')

describe('CEO context boundary', () => {
  test('route delegates organization/evidence module composition to the canonical composer', () => {
    expect(routeSource).not.toContain("from '@/lib/canonical-organization-prompt'")
    expect(routeSource).toContain('buildCeoContextModules(')
    expect(routeSource).toContain('modules: contextModules')
    expect(routeSource).toContain('modules: operationalModules')
    expect(composerSource).toContain("from '@/lib/canonical-organization-prompt'")
    expect(composerSource).toContain('export function buildCeoContextModules(')
  })

  test('context and evidence remain explicitly separated', () => {
    expect(composerSource).toContain('EVIDENCE CONTEXT (separate from conversation; provenance required)')
    expect(composerSource).toContain('SELECTED MEMORY (context only; not factual proof)')
    expect(composerSource).toContain('previous assistant claims are not factual proof')
  })
})
