import { describe, expect, test } from 'bun:test'
import { CEO_SYSTEM_CONTRACT, assertCeoSystemContract } from '@/lib/ceo-system-contract'
import { CEO_CAPABILITY_ARCHITECTURE, capabilityNeedFromDecision, findCapability } from '@/lib/ceo-capability-architecture'
import { selectCeoTool } from '@/lib/ceo-tool-selection'
import { assessEvidenceClaim, buildEvidenceBundle, createEvidenceSource, isEvidenceDecisionGrade } from '@/lib/ceo-evidence-bundle'
import { buildCeoWorldModel } from '@/lib/ceo-world-model'
import { buildCeoOperatorPlan, canClaimExecution } from '@/lib/ceo-operator-intelligence'
import { buildCanonicalConversationContext } from '@/lib/ceo-cognitive-conversation'
import { deriveCeoConversationState } from '@/lib/ceo-conversation-state'
import { buildConversationDecisionContract } from '@/lib/ceo-conversation-decision-contract'
import { preRouteCeoRequest } from '@/lib/ceo-pre-router'

describe('CEO phase 0 system contract', () => {
  test('has one explicit authority stack', () => {
    expect(assertCeoSystemContract()).toBe(true)
    expect(CEO_SYSTEM_CONTRACT.decisionAuthority).toBe('conversation_decision_contract')
    expect(CEO_SYSTEM_CONTRACT.capabilityAbstraction).toBe('capability_before_tool')
    expect(CEO_SYSTEM_CONTRACT.worldModel).toBe('single_world_with_facets')
    expect(CEO_SYSTEM_CONTRACT.executionTruth).toContain('execution_requires_observable_completion')
  })
})

describe('CEO phase 6 capability architecture', () => {
  test('exposes enterprise capability hierarchy without tool-number thinking', () => {
    expect(CEO_CAPABILITY_ARCHITECTURE.length).toBe(15)
    const research = findCapability('research.general')
    expect(research?.services[0].tools.some((tool) => tool.id === 'web_search')).toBe(true)
    const need = capabilityNeedFromDecision({ intent: 'research', selfReflectionKind: undefined, evidenceClass: 'external_web', domain: 'competitor', operation: 'research', temporalScope: 'current', evidenceProfile: 'competitor_research', evidenceRequirement: 'external_web', executionRequirement: 'one_tool', orchestrationOwner: 'operational_orchestrator', maxTurns: 4, maxRecoveries: 1, latencyBudgetMs: 30000, toolRequired: true, subagentsRequired: false, reason: 'test' })
    expect(need.domain).toBe('market_intelligence')
    expect(need.capabilities).toContain('research')
  })
})

describe('CEO phase 7 autonomous selection', () => {
  test('selects a real capability tool using weighted factors', () => {
    const result = selectCeoTool({ intent: 'research', evidenceClass: 'external_web', domain: 'general_web', operation: 'research', temporalScope: 'current', evidenceProfile: 'general_research', evidenceRequirement: 'external_web', executionRequirement: 'one_tool', orchestrationOwner: 'operational_orchestrator', maxTurns: 4, maxRecoveries: 1, latencyBudgetMs: 30000, toolRequired: true, subagentsRequired: false, reason: 'test' }, { requiresFreshness: true })
    expect(result.capability).toBe('research')
    expect(result.candidates.length).toBeGreaterThan(0)
    expect(result.selected?.id).toBe('web_search')
    expect(result.scores.web_search.total).toBeGreaterThan(0)
  })
})

describe('CEO phase 8 evidence intelligence', () => {
  test('distinguishes verified, stale and contradictory evidence', () => {
    const now = Date.now()
    const source = createEvidenceSource({ url: 'https://www.sec.gov/example', title: 'SEC Example', sourceType: 'sec_filing', retrievedAt: now - 1000, text: 'Revenue increased to 100 and cash was 40.' })
    const bundle = buildEvidenceBundle({ profile: 'public_equity', sources: [source], minimumSources: 1, minimumTierOneSources: 1 })
    const verified = assessEvidenceClaim({ claim: bundle.claims[0], now, maxAgeMs: 60_000, verified: true })
    expect(verified.state).toBe('verified')
    expect(isEvidenceDecisionGrade({ ...verified, confidence: 0.95 })).toBe(true)
    const stale = assessEvidenceClaim({ claim: bundle.claims[0], now, maxAgeMs: 500, verified: false })
    expect(stale.state).toBe('stale')
    const contradictory = assessEvidenceClaim({ claim: bundle.claims[0], now, maxAgeMs: 60_000, contradictorySourceIds: ['S2-x'] })
    expect(contradictory.state).toBe('contradictory')
    expect(isEvidenceDecisionGrade({ ...contradictory, confidence: 0.99 })).toBe(false)
  })
})

describe('CEO phase 9 living world model', () => {
  test('unifies user, business, system, external and conversation facets', () => {
    const message = 'We should prioritize compliance before adding new integrations.'
    const state = deriveCeoConversationState([], message)
    const context = buildCanonicalConversationContext({ currentMessage: message, rows: [], state, references: [], memories: [] })
    const model = buildCeoWorldModel({ context, priorConversation: [{ role: 'user', content: 'Our main goal is reliable operations.', createdAt: Date.now() }] })
    expect(model.user.data.goals.length).toBeGreaterThan(0)
    expect(model.business.data.decisions).toContain(message)
    expect(model.system.data.architecture).toContain('capability-oriented runtime')
    expect(model.external.data.evidenceState).toBe('none')
    expect(model.conversation.data.currentMessage).toBe(message)
  })
})

describe('CEO phase 10 operator intelligence', () => {
  test('never treats recommendation as completed execution', () => {
    const message = 'Should we prioritize compliance before adding integrations?'
    const state = deriveCeoConversationState([], message)
    const context = buildCanonicalConversationContext({ currentMessage: message, rows: [], state, references: [], memories: [] })
    const contract = buildConversationDecisionContract(context)
    const route = preRouteCeoRequest([{ role: 'user', content: message }], 0, context)
    const world = buildCeoWorldModel({ context })
    const plan = buildCeoOperatorPlan({ contract: route.executionContract, responseAction: contract.responseAction, objective: message, world, approved: false, executionEvidence: false })
    expect(plan.status).toBe('proposed')
    expect(canClaimExecution(plan)).toBe(false)
  })

  test('requires evidence and verification before an execution claim', () => {
    const message = 'Execute the approved operational change.'
    const state = deriveCeoConversationState([], message)
    const context = buildCanonicalConversationContext({ currentMessage: message, rows: [], state, references: [], memories: [] })
    const contract = buildConversationDecisionContract(context)
    const route = preRouteCeoRequest([{ role: 'user', content: message }], 0, context)
    const world = buildCeoWorldModel({ context })
    const blocked = buildCeoOperatorPlan({ contract: route.executionContract, responseAction: 'execute', objective: message, world, approved: true, executionEvidence: false })
    expect(blocked.status).toBe('blocked')
    expect(canClaimExecution(blocked)).toBe(false)
    const verified = buildCeoOperatorPlan({ contract: route.executionContract, responseAction: 'execute', objective: message, world, approved: true, executionEvidence: true, verificationState: 'LIVE_VERIFIED' })
    expect(verified.status).toBe('verified')
    expect(canClaimExecution(verified)).toBe(true)
  })
})