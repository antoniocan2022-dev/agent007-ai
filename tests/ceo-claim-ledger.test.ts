import { describe, expect, test } from 'bun:test'
import { createEvidenceSource } from '@/lib/ceo-evidence-bundle'
import { detectContradictions } from '@/lib/ceo-contradiction-resolver'
import {
  buildClaimLedgerEntries,
  claimKeyFor,
  crossTurnContradictions,
  DEFAULT_CROSS_TURN_CLAIM_MAX_AGE_MS,
  lookupRecentVerifiedClaims,
  recordVerifiedClaims,
  type PriorVerifiedClaim,
} from '@/lib/ceo-claim-ledger'

describe('P0: claim ledger key/entry construction (pure, no I/O)', () => {
  test('claimKeyFor normalizes the subject and prefixes it onto the metric', () => {
    expect(claimKeyFor('geos', 'revenue')).toBe('GEOS:revenue')
    expect(claimKeyFor('  Geos  ', 'market_cap')).toBe('GEOS:market_cap')
  })

  test('a single tier-1 SEC source produces a VERIFIED claim', () => {
    const source = createEvidenceSource({ url: 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000940578.json', title: 'GEOS SEC Company Facts', sourceType: 'sec_companyfacts', sourceTier: 1, retrievedAt: Date.now(), text: 'Revenue: 100000000 (10-K, filed 2026-08-01)', id: 'SEC-GEOS' })
    const entries = buildClaimLedgerEntries('GEOS', [source], [])
    expect(entries).not.toBeNull()
    expect(entries!.claims.length).toBe(1)
    expect(entries!.claims[0].claimKey).toBe('GEOS:revenue')
    expect(entries!.claims[0].verificationStatus).toBe('VERIFIED')
    expect(entries!.claims[0].confidence).toBe(0.95)
    expect(entries!.sources.length).toBe(1)
  })

  test('a tier-3+ source alone produces an UNVERIFIED claim', () => {
    const source = createEvidenceSource({ url: 'https://example.com/report', title: 'Report', sourceType: 'web', sourceTier: 3, retrievedAt: Date.now(), text: 'Revenue: 90000000', id: 'PAGE-1' })
    const entries = buildClaimLedgerEntries('GEOS', [source], [])
    expect(entries!.claims[0].verificationStatus).toBe('UNVERIFIED')
  })

  test('a contested metric is recorded as PARTIAL with the contradiction-preferred value', () => {
    const now = Date.now()
    const a = createEvidenceSource({ url: 'https://sec.gov/a', title: 'SEC', sourceType: 'sec_filing', sourceTier: 1, retrievedAt: now, text: 'Revenue: 100000000' })
    const b = createEvidenceSource({ url: 'https://example.com/b', title: 'News', sourceType: 'news', sourceTier: 3, retrievedAt: now, text: 'Revenue: 150000000' })
    const contradictions = detectContradictions([a, b])
    expect(contradictions.length).toBe(1)
    const entries = buildClaimLedgerEntries('GEOS', [a, b], contradictions)
    expect(entries!.claims.length).toBe(1)
    expect(entries!.claims[0].verificationStatus).toBe('PARTIAL')
    expect(entries!.claims[0].notes).toContain('contradiction')
    // preferred value should be a's (tier 1 beats tier 3)
    expect(entries!.claims[0].claimText).toContain('100000000')
  })

  test('sources with no extractable metric produce no ledger entries', () => {
    const source = createEvidenceSource({ url: 'https://example.com/nothing', title: 'Nothing', sourceType: 'web', sourceTier: 3, retrievedAt: Date.now(), text: 'This document discusses unrelated matters entirely.' })
    expect(buildClaimLedgerEntries('GEOS', [source], [])).toBeNull()
  })
})

describe('P0: claim ledger write/read fail open when the database is unavailable', () => {
  test('recordVerifiedClaims does not throw and reports recorded:false with no extractable claim', async () => {
    const source = createEvidenceSource({ url: 'https://example.com/nothing2', title: 'Nothing', sourceType: 'web', sourceTier: 3, retrievedAt: Date.now(), text: 'Nothing extractable here.' })
    const result = await recordVerifiedClaims({ subject: 'GEOS', sources: [source], contradictions: [] })
    expect(result.recorded).toBe(false)
  })

  test('recordVerifiedClaims fails open (never throws) when the database is unreachable', async () => {
    const source = createEvidenceSource({ url: 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000940578.json', title: 'GEOS SEC Company Facts', sourceType: 'sec_companyfacts', sourceTier: 1, retrievedAt: Date.now(), text: 'Revenue: 100000000', id: 'SEC-GEOS' })
    const result = await recordVerifiedClaims({ subject: 'GEOS', sources: [source], contradictions: [] })
    expect(result.recorded).toBe(false)
  })

  test('lookupRecentVerifiedClaims fails open to an empty array when the database is unreachable', async () => {
    const claims = await lookupRecentVerifiedClaims('GEOS', DEFAULT_CROSS_TURN_CLAIM_MAX_AGE_MS)
    expect(claims).toEqual([])
  })

  test('lookupRecentVerifiedClaims returns [] immediately for a blank subject without touching the database', async () => {
    expect(await lookupRecentVerifiedClaims('   ', DEFAULT_CROSS_TURN_CLAIM_MAX_AGE_MS)).toEqual([])
  })
})

describe('P0: cross-turn contradiction detection (pure, no I/O)', () => {
  test('a >15% disagreement with a prior verified claim is flagged, preferring the higher-tier source', () => {
    const now = Date.now()
    const current = createEvidenceSource({ url: 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000940578.json', title: 'GEOS SEC Company Facts', sourceType: 'sec_companyfacts', sourceTier: 1, retrievedAt: now, text: 'Revenue: 100000000', id: 'SEC-GEOS' })
    const priorClaims: PriorVerifiedClaim[] = [{ metric: 'revenue', value: 140000000, sourceUrl: 'https://example.com/old-report', retrievedAt: now - 60 * 60 * 1000, ledgerId: 'ledger-1' }]
    const records = crossTurnContradictions('GEOS', [current], priorClaims)
    expect(records.length).toBe(1)
    expect(records[0].metric).toBe('revenue')
    // current source is tier 1 (sec.gov), prior claim's stored URL is tier 4 (unranked domain) -- current should win
    expect(records[0].preferredSourceId).toBe('SEC-GEOS')
    expect(records[0].reason).toContain('cross-turn')
  })

  test('a small relative difference against a prior claim is not flagged', () => {
    const now = Date.now()
    const current = createEvidenceSource({ url: 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000940578.json', title: 'GEOS SEC Company Facts', sourceType: 'sec_companyfacts', sourceTier: 1, retrievedAt: now, text: 'Revenue: 100000000', id: 'SEC-GEOS' })
    const priorClaims: PriorVerifiedClaim[] = [{ metric: 'revenue', value: 103000000, sourceUrl: 'https://example.com/old-report', retrievedAt: now - 60 * 60 * 1000, ledgerId: 'ledger-1' }]
    expect(crossTurnContradictions('GEOS', [current], priorClaims)).toEqual([])
  })

  test('no prior claims means no cross-turn contradictions can be produced', () => {
    const source = createEvidenceSource({ url: 'https://data.sec.gov/x', title: 'X', sourceType: 'sec_companyfacts', sourceTier: 1, retrievedAt: Date.now(), text: 'Revenue: 100000000' })
    expect(crossTurnContradictions('GEOS', [source], [])).toEqual([])
  })

  test('a metric absent from the current sources produces no contradiction even with a prior claim for it', () => {
    const source = createEvidenceSource({ url: 'https://data.sec.gov/y', title: 'Y', sourceType: 'sec_companyfacts', sourceTier: 1, retrievedAt: Date.now(), text: 'Cash: 5000000' })
    const priorClaims: PriorVerifiedClaim[] = [{ metric: 'revenue', value: 140000000, sourceUrl: 'https://example.com/old-report', retrievedAt: Date.now(), ledgerId: 'ledger-1' }]
    expect(crossTurnContradictions('GEOS', [source], priorClaims)).toEqual([])
  })
})
