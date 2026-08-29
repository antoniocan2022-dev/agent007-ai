import { describe, expect, test } from 'bun:test'
import { buildCeoDecisionPlan } from '@/lib/ceo-cognitive-kernel'
import { preRouteCeoRequest, resolvePreRoute } from '@/lib/ceo-pre-router'
import { getOrchestrationOwner, withOrchestrationOwner } from '@/lib/ceo-execution-owner'

const exactFailingMessage = 'Hows it going? make a sekf analysis and tell me if you are ready to mange businesses?'
const exactStockResearchMessage = 'Make a deep analysis of the stocks: Geospace Technologies Corporation (GEOS) and MIND Technology, Inc. (MIND). make a deep comprehension and tell me would you invest in those stock? make me a comprehensible and simple explanation.'

describe('CEO execution contract', () => {
  test('routes the exact failed self-analysis message to the CEO lifecycle without operations', () => {
    const decision = preRouteCeoRequest([{ role: 'user', content: exactFailingMessage }])

    expect(decision.executionContract.intent).toBe('self_assessment')
    expect(decision.executionContract.evidenceRequirement).toBe('internal_state')
    expect(decision.executionContract.executionRequirement).toBe('llm_only')
    expect(decision.executionContract.orchestrationOwner).toBe('ceo_lifecycle')
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

  test('routes named public-equity analysis to fresh external research', () => {
    const decision = preRouteCeoRequest([{ role: 'user', content: exactStockResearchMessage }])

    expect(decision.executionContract.intent).toBe('research')
    expect(decision.executionContract.evidenceRequirement).toBe('external_web')
    expect(decision.executionContract.orchestrationOwner).toBe('operational_orchestrator')
    expect(decision.executionContract.toolRequired).toBe(true)
    expect(decision.executionContract.executionRequirement).toBe('one_tool')
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
    expect(plan.executionContract.evidenceRequirement).toBe('external_web')
    expect(plan.executionContract.orchestrationOwner).toBe('operational_orchestrator')
  })

  test('hands generic research and operational actions to the operational orchestrator', () => {
    const research = preRouteCeoRequest([{ role: 'user', content: 'Research the latest competitors in the AI executive software market.' }])
    expect(research.executionContract.intent).toBe('research')
    expect(research.executionContract.orchestrationOwner).toBe('operational_orchestrator')
    expect(research.executionContract.toolRequired).toBe(true)
    expect(research.executionContract.executionRequirement).toBe('one_tool')

    const production = preRouteCeoRequest([{ role: 'user', content: 'Deploy the approved release to production.' }])
    expect(production.executionContract.intent).toBe('production_action')
    expect(production.executionContract.orchestrationOwner).toBe('operational_orchestrator')
    expect(production.executionContract.executionRequirement).toBe('production')
    expect(production.executionContract.toolRequired).toBe(true)
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
