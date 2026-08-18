import { beforeEach, describe, expect, test } from 'bun:test'
import { db } from './db'
import {
  assertDelegationAllowed,
  authorityLevelFor,
  buildArtifactId,
  buildOutcomeId,
  canTransitionMission,
  createVentureControlContract,
  recordBusinessOutcome,
  registerArtifact,
} from './architecture-control-plane'
import { getCapabilityMetadata } from './autonomy/capability-registry'
import { canAdvanceBookStage, canAdvanceCommercial, validateV001BookSpecification } from './venture-autonomy-control'
import { validateCanonicalVentureTemplate, CANONICAL_VENTURE_TEMPLATE } from './venture-template'
import { buildV002V003Factory, getVentureFactoryBlueprint } from './venture-factory'

const requiredEvidence = [...CANONICAL_VENTURE_TEMPLATE.requiredEvidence]

beforeEach(async () => {
  await db.memory.deleteMany({ where: { key: { startsWith: 'deep-audit:' } } })
})

describe('Venture OS 5–17 deep integrity audit', () => {
  test('5: unknown identities cannot inherit specialist authority', () => {
    expect(authorityLevelFor('unknown_actor')).toBe('UNKNOWN')
    expect(authorityLevelFor('unknown_tool')).toBe('UNKNOWN')
    expect(() => assertDelegationAllowed({
      actorId: 'unknown_actor', actorLevel: 'SPECIALIST', targetId: 'quill', targetLevel: 'SPECIALIST',
    })).toThrow(/unregistered actor identity/i)
    expect(() => assertDelegationAllowed({
      actorId: 'aurora', actorLevel: 'LEADER', targetId: 'unknown_tool', targetLevel: 'TOOL',
    })).toThrow(/unregistered target identity/i)
    expect(getCapabilityMetadata('web_search')?.category).toBe('read')
    expect(authorityLevelFor('web_search')).toBe('TOOL')
  })

  test('6: artifact identity is immutable and duplicate creation is idempotent', async () => {
    const base = {
      ventureId: 'venture_001', missionId: 'deep-audit:artifact', stage: 'research', producer: 'scout',
      consumers: ['aurora', 'aurora'], artifactType: 'data' as const, value: 'market evidence', version: 1, supersedes: null,
    }
    const artifact = await registerArtifact({ ...base, artifactId: 'deep-audit:artifact:1' })
    expect(artifact.consumers).toEqual(['aurora'])
    expect(await registerArtifact({ ...base, artifactId: 'deep-audit:artifact:1' })).toEqual(artifact)
    await expect(registerArtifact({ ...base, artifactId: 'deep-audit:artifact:1', value: 'different evidence' })).rejects.toThrow(/identity collision/i)
    expect(buildArtifactId(base)).toBe(buildArtifactId(base))
  })

  test('7: mission terminal states and illegal skips remain impossible', () => {
    expect(canTransitionMission('COMPLETED', 'IN_PROGRESS')).toBe(false)
    expect(canTransitionMission('FAILED', 'IN_PROGRESS')).toBe(false)
    expect(canTransitionMission('VERIFIED', 'OWNER_APPROVAL')).toBe(true)
    expect(canTransitionMission('EXECUTING' as never, 'COMPLETED' as never)).toBe(false)
  })

  test('8: outcome identity cannot silently overwrite a different business fact', async () => {
    const occurredAt = '2026-08-17T20:00:00.000Z'
    const base = {
      ventureId: 'venture_001', missionId: 'deep-audit:outcome', type: 'TRANSACTION' as const,
      transactionId: 'payment-deep-audit', customerId: 'customer-deep-audit', amount: 25, currency: 'USD',
      source: 'deep-audit', occurredAt, metadata: {},
    }
    const first = await recordBusinessOutcome({ ...base, outcomeId: 'deep-audit:outcome:1' })
    expect(await recordBusinessOutcome({ ...base, outcomeId: 'deep-audit:outcome:1' })).toEqual(first)
    await expect(recordBusinessOutcome({ ...base, outcomeId: 'deep-audit:outcome:1', amount: 30 })).rejects.toThrow(/identity collision/i)

    const costBase = {
      ventureId: 'venture_001', missionId: 'deep-audit:cost', type: 'COST_RECORDED' as const,
      transactionId: null, customerId: null, amount: 25, currency: 'USD', source: 'deep-audit',
      occurredAt: '2026-08-17T20:00:00.000Z', metadata: {},
    }
    expect(buildOutcomeId(costBase)).not.toBe(buildOutcomeId({
      ...costBase,
      occurredAt: '2026-08-17T20:00:01.000Z',
    }))
  })

  test('9: active future venture contracts cannot drift from the canonical evidence contract', async () => {
    await expect(createVentureControlContract('deep-audit:future', {
      status: 'ACTIVE',
      requiredEvidence: requiredEvidence.slice(0, 6),
    })).rejects.toThrow(/canonical evidence dimensions/i)

    const contract = await createVentureControlContract('deep-audit:future-valid', {
      status: 'ACTIVE',
      requiredEvidence,
    })
    expect(contract.status).toBe('ACTIVE')
    expect(contract.requiredEvidence).toEqual(requiredEvidence)
  })

  test('10: readiness evidence vocabulary remains exactly canonical', async () => {
    const contract = await createVentureControlContract('deep-audit:readiness', {
      status: 'DRAFT',
      requiredEvidence,
    })
    expect(contract.requiredEvidence).toEqual(requiredEvidence)
    expect(new Set(contract.requiredEvidence).size).toBe(7)
  })

  test('11: V001 production contract rejects malformed specifications and illegal stage jumps', () => {
    const chapters = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven']
    expect(validateV001BookSpecification({ chapterCount: 7, pageCount: 25, chapters })).toEqual([])
    expect(validateV001BookSpecification({ chapterCount: 6, pageCount: 25, chapters: chapters.slice(0, 6) }).length).toBeGreaterThan(0)
    expect(validateV001BookSpecification({ chapterCount: 7, pageCount: 31, chapters }).length).toBeGreaterThan(0)
    expect(validateV001BookSpecification({ chapterCount: 7, pageCount: 25, chapters: ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'one'] }).some((e) => /duplicates/i.test(e))).toBe(true)
    expect(canAdvanceBookStage('BRIEF', 'OUTLINE')).toBe(true)
    expect(canAdvanceBookStage('BRIEF', 'DRAFT')).toBe(false)
    expect(canAdvanceBookStage('PUBLISHED', 'BRIEF')).toBe(false)
  })

  test('12: commercial lifecycle is monotonic and never bypasses state gates', () => {
    expect(canAdvanceCommercial('PROSPECT', 'QUALIFIED')).toBe(true)
    expect(canAdvanceCommercial('PROSPECT', 'PAID')).toBe(false)
    expect(canAdvanceCommercial('PAID', 'FULFILLMENT')).toBe(true)
    expect(canAdvanceCommercial('FULFILLED', 'REFUNDED')).toBe(false)
    expect(canAdvanceCommercial('REFUND_PENDING', 'REFUNDED')).toBe(true)
  })

  test('13–14: template and autonomy primitives remain canonical', () => {
    expect(validateCanonicalVentureTemplate()).toEqual([])
    expect(CANONICAL_VENTURE_TEMPLATE.readiness.syntheticOutcomesForbidden).toBe(true)
  })

  test('16–17: future venture shells are structural-only and idempotent', async () => {
    const specs = [
      { ventureId: 'venture_002', name: 'Deep Audit V002', type: 'saas' as const, description: 'Structural shell.', targetMarket: 'Future market', pricingModel: 'Validation-first' },
      { ventureId: 'venture_003', name: 'Deep Audit V003', type: 'service' as const, description: 'Structural shell.', targetMarket: 'Future market', pricingModel: 'Validation-first' },
    ] as const
    const first = await buildV002V003Factory(specs)
    expect(first).toHaveLength(2)
    expect(first.every((item) => item.blueprint.lifecycleStage === 'proposed')).toBe(true)
    expect((first[0].blueprint as typeof first[0]['blueprint'] & { launchAuthorized?: boolean }).launchAuthorized).toBe(false)
    expect(await getVentureFactoryBlueprint('venture_002')).not.toBeNull()
    expect(await getVentureFactoryBlueprint('venture_003')).not.toBeNull()

    const second = await buildV002V003Factory(specs)
    expect(second.every((item) => !item.created && !item.repaired)).toBe(true)
  })
})
