import { describe, expect, test } from 'bun:test'
import { CANONICAL_CAPABILITY_LEDGER, buildIntegrationContract, evidencePolicyFor, riskClassForDomain, assertCanonicalOwner } from '@/lib/architecture-integrity-contract'
import { assessDecisionGradeEvidence, assertDecisionGradeEvidence, DecisionGradeEvidenceBlockedError } from '@/lib/ceo-decision-grade-evidence'
import { buildEvidenceBundle, createEvidenceSource } from '@/lib/ceo-evidence-bundle'
import { buildRiskAbstention } from '@/lib/ceo-degraded-mode'
import { verifyClaimEvidence } from '@/lib/ceo-claim-evidence-gate'

describe('Architecture integrity contract — phases 0-4', () => {
  test('canonical ledger has one owner per critical concern and complete Phase 0 metadata', () => {
    const entries = Object.values(CANONICAL_CAPABILITY_LEDGER)
    expect(entries.length).toBeGreaterThanOrEqual(7)
    expect(new Set(entries.map((entry) => entry.canonicalOwner)).size).toBe(entries.length)
    for (const entry of entries) {
      expect(entry.subsystem.length).toBeGreaterThan(0)
      expect(entry.runtimeEntryPoints.length).toBeGreaterThan(0)
      expect(entry.orchestrationOwners.length).toBeGreaterThan(0)
      expect(entry.consumers.length).toBeGreaterThan(0)
      expect(entry.requiredContracts.length).toBeGreaterThan(0)
      expect(entry.verificationMethod.length).toBeGreaterThan(0)
      expect(entry.integrationProof.length).toBeGreaterThan(0)
      expect(entry.tests.length).toBeGreaterThan(0)
      expect(entry.ciGates.length).toBeGreaterThan(0)
      expect(['DISCOVERED', 'CANONICAL', 'INTEGRATED', 'OBSERVED', 'PROVEN']).toContain(entry.lifecycleState)
    }
  })

  test('integration contracts require canonical ownership and runtime proof', () => {
    const contract = buildIntegrationContract('evidence_acquisition')
    expect(contract.canonicalOwner).toContain('ceo-evidence-executor')
    expect(contract.entryPoint).toBe('src/app/api/agent/route.ts')
    expect(contract.failClosed).toBe(false)
    expect(() => assertCanonicalOwner('evidence_acquisition', 'wrong-owner')).toThrow(/Non-canonical implementation/)
  })

  test('risk policy makes public equity and financial decisions high risk', () => {
    expect(riskClassForDomain('public_equity')).toBe('HIGH')
    expect(riskClassForDomain('internal_finance', 'recommend')).toBe('HIGH')
    expect(riskClassForDomain('general_web', 'explain')).toBe('LOW')
    expect(evidencePolicyFor({ domain: 'public_equity', operation: 'recommend' })).toBe('DECISION_GRADE')
  })

  test('equity evidence is decision-grade only when every mandatory dimension is covered', () => {
    const sources = [
      createEvidenceSource({ id: 'sec', url: 'https://www.sec.gov/example', title: 'SEC 10-Q', sourceType: 'sec_companyfacts', sourceTier: 1, retrievedAt: Date.now(), text: 'Issuer company ticker NASDAQ revenue sales earnings net income cash debt liabilities 10-Q quarterly report recent order backlog contract risk dilution.' }),
      createEvidenceSource({ id: 'market', url: 'https://stockanalysis.com/stocks/example', title: 'Market data', sourceType: 'market_data', sourceTier: 2, retrievedAt: Date.now(), text: 'Share price market cap shares outstanding enterprise value valuation P/E.' }),
      createEvidenceSource({ id: 'news', url: 'https://www.reuters.com/example', title: 'Recent events', sourceType: 'news', sourceTier: 3, retrievedAt: Date.now(), text: 'Latest recent announcement catalyst growth recovery turnaround risk.' }),
      createEvidenceSource({ id: 'company', url: 'https://company.example/investor', title: 'Company investor relations', sourceType: 'company_ir', sourceTier: 4, retrievedAt: Date.now(), text: 'Company investor presentation catalyst order backlog risk valuation recommendation investment decision.' }),
    ]
    const bundle = buildEvidenceBundle({ profile: 'public_equity', sources, minimumSources: 3, minimumTierOneSources: 1 })
    const assessed = assessDecisionGradeEvidence({ domain: 'public_equity', operation: 'recommend', bundle, verifiedClaimCount: 0, unverifiedClaimCount: 0 })
    expect(assessed.sufficient).toBe(true)
    expect(assessed.missingDimensions).toEqual([])
    expect(assessed.decisionGrade).toBe(true)
  })

  test('high-risk evidence gate fails closed rather than permitting incomplete research', () => {
    const bundle = buildEvidenceBundle({ profile: 'public_equity', sources: [createEvidenceSource({ id: 'one', url: 'https://www.sec.gov/example', title: 'SEC', sourceType: 'sec_companyfacts', sourceTier: 1, retrievedAt: Date.now(), text: 'Revenue cash debt.' })], minimumSources: 3, minimumTierOneSources: 1 })
    const assessment = assessDecisionGradeEvidence({ domain: 'public_equity', operation: 'recommend', bundle })
    expect(assessment.decisionGrade).toBe(false)
    expect(assessment.reasons.length).toBeGreaterThan(0)
    expect(() => assertDecisionGradeEvidence({ domain: 'public_equity', operation: 'recommend', bundle })).toThrow(DecisionGradeEvidenceBlockedError)
    try { assertDecisionGradeEvidence({ domain: 'public_equity', operation: 'recommend', bundle }) } catch (error) { expect(error).toMatchObject({ code: 'ABSTAINED_REQUIRED_EVIDENCE' }) }
  })

  test('high-risk degraded mode produces explicit abstention and no recovered-memory recommendation', () => {
    const response = buildRiskAbstention('Analyze GEOS and MIND and tell me whether we should invest.', 'Required external evidence was unavailable.', 'evidence_unavailable')
    expect(response.evidenceState).toBe('UNAVAILABLE')
    expect(response.recoveredCapability).toBe('evidence')
    expect(response.sourceKeys).toEqual([])
    expect(response.content).toContain('ABSTAINED_REQUIRED_EVIDENCE')
    expect(response.content).not.toContain('My read is that we can still move this forward using what we\'ve already established')
  })

  test('public-equity claim verification throws the same explicit abstention code on unsupported claims', () => {
    const bundle = buildEvidenceBundle({ profile: 'public_equity', sources: [createEvidenceSource({ id: 'sec', url: 'https://www.sec.gov/example', title: 'SEC', sourceType: 'sec_companyfacts', sourceTier: 1, retrievedAt: Date.now(), text: 'Revenue 10 million and cash 2 million.' })], minimumSources: 1, minimumTierOneSources: 1 })
    expect(() => verifyClaimEvidence('The latest stock price is $999.', bundle)).toThrow(/ABSTAINED_REQUIRED_EVIDENCE/)
  })
})
