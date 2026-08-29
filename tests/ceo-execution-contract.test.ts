import { describe, expect, test } from 'bun:test'
import { buildCeoDecisionPlan } from '@/lib/ceo-cognitive-kernel'
import { preRouteCeoRequest, resolvePreRoute } from '@/lib/ceo-pre-router'
import { getOrchestrationOwner, withOrchestrationOwner } from '@/lib/ceo-execution-owner'
import { buildExternalEvidencePlan, extractEquityTickers } from '@/lib/ceo-evidence-planner'
import { buildEvidenceBundle, createEvidenceSource } from '@/lib/ceo-evidence-bundle'

const exactFailingMessage = 'Hows it going? make a sekf analysis and tell me if you are ready to mange businesses?'
const exactStockResearchMessage = 'Make a deep analysis of the stocks: Geospace Technologies Corporation (GEOS) and MIND Technology, Inc. (MIND). make a deep comprehension and tell me would you invest in those stock? make me a comprehensible and simple explanation.'

describe('CEO execution contract', () => {
  test('routes the exact failed self-analysis message to the CEO lifecycle without operations', () => {
    const decision = preRouteCeoRequest([{ role: 'user', content: exactFailingMessage }])

    expect(decision.executionContract.intent).toBe('self_assessment')
    expect(decision.executionContract.evidenceRequirement).toBe('internal_state')
    expect(decision.executionContract.executionRequirement).toBe('llm_only')
    expect(decision.executionContract.orchestrationOwner).toBe('ceo_lifecycle')
    expect(decision.executionContract.evidenceClass).toBe('internal_state')
    expect(decision.executionContract.domain).toBe('internal_operations')
    expect(decision.executionContract.operation).toBe('analyze')
    expect(decision.executionContract.temporalScope).toBe('current')
    expect(decision.executionContract.toolRequired).toBe(false)
    expect(decision.executionContract.subagentsRequired).toBe(false)
    expect(decision.executionContract.maxRecoveries).toBe(0)
    expect(decision.executionContract.latencyBudgetMs).toBe(30000)
    expect(decision.route).toBe('fast')
    expect(resolvePreRoute(decision)).toBe('fast')

    const plan = buildCeoDecisionPlan({
      messages: [{ role: 'user', content: exactFailingMessage }],
      preRoute: decision,
    })

    expect(plan.path).toBe('fast')
    expect(plan.reasoningStrategy).toBe('direct')
    expect(plan.cognitiveDepth).toBe(0)
    expect(plan.executionContract.orchestrationOwner).toBe('ceo_lifecycle')
    expect(plan.maxEscalations).toBe(0)
    expect(plan.maxProviderAttempts).toBe(4)
    expect(plan.latencyBudgetMs).toBe(30000)
  })

  test('keeps non-operational analysis CEO-owned even when it is deep', () => {
    const decision = preRouteCeoRequest([{ role: 'user', content: 'Analyze the full architecture and identify the most important weaknesses.' }])

    expect(decision.executionContract.intent).toBe('analysis')
    expect(decision.executionContract.evidenceClass).toBe('internal_state')
    expect(decision.executionContract.orchestrationOwner).toBe('ceo_lifecycle')
    expect(decision.executionContract.toolRequired).toBe(false)
    expect(decision.executionContract.subagentsRequired).toBe(false)
    expect(decision.route).toBe('full')

    const plan = buildCeoDecisionPlan({
      messages: [{ role: 'user', content: 'Analyze the full architecture and identify the most important weaknesses.' }],
      preRoute: decision,
    })
    expect(plan.path).toBe('full')
    expect(plan.reasoningStrategy).toBe('multi_pass')
    expect(plan.executionContract.orchestrationOwner).toBe('ceo_lifecycle')
  })

  test('routes the exact GEOS/MIND request before the context ambiguity branch', () => {
    const decision = preRouteCeoRequest([{ role: 'user', content: exactStockResearchMessage }])

    expect(decision.executionContract.intent).toBe('research')
    expect(decision.executionContract.evidenceRequirement).toBe('multi_source')
    expect(decision.executionContract.orchestrationOwner).toBe('ceo_lifecycle')
    expect(decision.executionContract.executionRequirement).toBe('multi_source')
    expect(decision.executionContract.evidenceClass).toBe('external_web')
    expect(decision.executionContract.domain).toBe('public_equity')
    expect(decision.executionContract.operation).toBe('recommend')
    expect(decision.executionContract.temporalScope).toBe('current')
    expect(decision.executionContract.evidenceProfile).toBe('public_equity')
    expect(decision.executionContract.toolRequired).toBe(true)
    expect(decision.adaptiveExecutionClass).toBe('deep')
    expect(decision.route).toBe('full')
    expect(resolvePreRoute(decision)).toBe('full')

    const plan = buildCeoDecisionPlan({
      messages: [{ role: 'user', content: exactStockResearchMessage }],
      preRoute: decision,
    })
    expect(plan.path).toBe('full')
    expect(plan.qualityTier).toBe('high')
    expect(plan.reasoningStrategy).toBe('multi_pass')
    expect(plan.executionContract.evidenceRequirement).toBe('multi_source')
    expect(plan.executionContract.orchestrationOwner).toBe('ceo_lifecycle')
  })

  test.each([
    ['Analyze whether we should buy a second server', 'analysis', 'internal_operations'],
    ['Analyze our stock of spare parts', 'analysis', 'internal_operations'],
    ['Review the equity split between co-founders', 'analysis', 'internal_operations'],
    ['Analyze our cash flow forecast', 'analysis', 'internal_operations'],
    ['Review our earnings report', 'analysis', 'internal_finance'],
    ['Hold a review meeting tomorrow', 'tool_action', 'internal_operations'],
  ] as const)('does not misroute internal phrase: %s', (message, expectedIntent, expectedDomain) => {
    const decision = preRouteCeoRequest([{ role: 'user', content: message }])
    expect(decision.executionContract.intent).toBe(expectedIntent)
    expect(decision.executionContract.domain).toBe(expectedDomain)
    expect(decision.executionContract.evidenceClass).toBe('internal_state')
    expect(decision.executionContract.domain).not.toBe('public_equity')
  })

  test('hands generic external research to the operational orchestrator', () => {
    const research = preRouteCeoRequest([{ role: 'user', content: 'Research the latest competitors in the AI executive software market.' }])
    expect(research.executionContract.intent).toBe('research')
    expect(research.executionContract.orchestrationOwner).toBe('operational_orchestrator')
    expect(research.executionContract.evidenceClass).toBe('external_web')
    expect(research.executionContract.domain).toBe('competitor')
    expect(research.executionContract.toolRequired).toBe(true)
    expect(research.executionContract.executionRequirement).toBe('one_tool')

    const production = preRouteCeoRequest([{ role: 'user', content: 'Deploy the approved release to production.' }])
    expect(production.executionContract.intent).toBe('production_action')
    expect(production.executionContract.orchestrationOwner).toBe('operational_orchestrator')
    expect(production.executionContract.executionRequirement).toBe('production')
    expect(production.executionContract.toolRequired).toBe(true)
  })

  test('builds a deterministic public-equity evidence plan', () => {
    expect(extractEquityTickers(exactStockResearchMessage)).toEqual(['GEOS', 'MIND'])
    const plan = buildExternalEvidencePlan({
      objective: exactStockResearchMessage,
      evidenceClass: 'external_web',
      domain: 'public_equity',
      operation: 'recommend',
      temporalScope: 'current',
      evidenceProfile: 'public_equity',
    })
    expect(plan.profile).toBe('public_equity')
    expect(plan.minimumSources).toBeGreaterThanOrEqual(3)
    expect(plan.queries.length).toBeGreaterThanOrEqual(6)
    expect(plan.queries.some((q) => q.query.includes('GEOS'))).toBe(true)
    expect(plan.queries.some((q) => q.query.includes('MIND'))).toBe(true)
  })

  test('normalizes evidence sources into a bundle with freshness and provenance', () => {
    const now = Date.now()
    const source = createEvidenceSource({
      url: 'https://www.sec.gov/Archives/edgar/data/example/filing.htm',
      title: 'Example SEC filing',
      sourceType: 'sec_filing',
      sourceTier: 1,
      retrievedAt: now,
      publishedAt: now - 10 * 24 * 60 * 60 * 1000,
      text: 'Revenue was 100 million dollars and cash was 20 million dollars.',
    })
    const bundle = buildEvidenceBundle({ profile: 'public_equity', sources: [source] })
    expect(bundle.sources).toHaveLength(1)
    expect(bundle.sources[0].sourceTier).toBe(1)
    expect(bundle.freshness.observedAt).toBe(now)
    expect(bundle.sources[0].provenance.length).toBeGreaterThan(0)
  })

  test('keeps orchestration ownership request-scoped and isolated', async () => {
    expect(getOrchestrationOwner()).toBeNull()

    const seen: string[] = []
    await Promise.all([
      withOrchestrationOwner('operational_orchestrator', async () => {
        await Promise.resolve()
        seen.push(getOrchestrationOwner() ?? 'none')
      }),
      withOrchestrationOwner('ceo_lifecycle', async () => {
        await Promise.resolve()
        seen.push(getOrchestrationOwner() ?? 'none')
      }),
    ])

    expect(seen.sort()).toEqual(['ceo_lifecycle', 'operational_orchestrator'])
    expect(getOrchestrationOwner()).toBeNull()
  })
})