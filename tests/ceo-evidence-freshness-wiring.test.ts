import { describe, expect, test } from 'bun:test'
import { buildEvidenceBundle, createEvidenceSource, renderEvidenceBundleForPrompt } from '@/lib/ceo-evidence-bundle'

describe('Phase 8 evidence freshness wired into real prompt rendering', () => {
  test('a bundle built entirely from freshly-retrieved sources reports no stale claims', () => {
    const now = Date.now()
    const source = createEvidenceSource({ url: 'https://example.com/fresh', title: 'Fresh', sourceType: 'web', retrievedAt: now - 1000, text: 'Revenue increased to 100.' })
    const bundle = buildEvidenceBundle({ profile: 'general_research', sources: [source] })
    const rendered = renderEvidenceBundleForPrompt(bundle)
    expect(rendered).toContain('all extracted claims are within this profile')
  })

  test('a bundle built from a source retrieved well outside the profile freshness window is explicitly flagged as stale', () => {
    const now = Date.now()
    const source = createEvidenceSource({ url: 'https://example.com/stale', title: 'Stale', sourceType: 'web', retrievedAt: now - 1000 * 60 * 60 * 24 * 400, text: 'Revenue was 80 last year.' })
    const bundle = buildEvidenceBundle({ profile: 'general_research', sources: [source] })
    const rendered = renderEvidenceBundleForPrompt(bundle)
    expect(rendered).toContain('older than this profile')
    expect(rendered).toContain('potentially outdated, not current')
  })

  test('staleness flagging never claims anything is verified -- the existing unverified-until-governed-verification disclaimer remains intact', () => {
    const now = Date.now()
    const source = createEvidenceSource({ url: 'https://example.com/x', title: 'X', sourceType: 'web', retrievedAt: now, text: 'Some claim.' })
    const bundle = buildEvidenceBundle({ profile: 'general_research', sources: [source] })
    const rendered = renderEvidenceBundleForPrompt(bundle)
    expect(rendered).toContain('unverified until the governed verification step')
  })
})
