import { beforeEach, describe, expect, test } from 'bun:test'
import { db } from './db'
import { enqueueAutonomyWork, runAutonomyManagerTick, getAutonomyManagerStatus } from './autonomy/autonomy-manager'
import { CANONICAL_VENTURE_TEMPLATE, validateCanonicalVentureTemplate } from './venture-template'
import { buildV002V003Factory, getVentureFactoryBlueprint, validateVentureFactorySpec } from './venture-factory'

describe('Venture OS upgrades 14–17', () => {
  beforeEach(async () => {
    await db.memory.deleteMany({ where: { category: { in: ['venture_autonomy_work', 'venture_autonomy_run', 'venture_autonomy_lease', 'venture_factory_blueprint'] } } })
  })

  test('canonical venture template is internally consistent and preserves V001 reference', () => {
    expect(validateCanonicalVentureTemplate()).toEqual([])
    expect(CANONICAL_VENTURE_TEMPLATE.version).toBe(1)
    expect(CANONICAL_VENTURE_TEMPLATE.requiredEvidence).toHaveLength(7)
    expect(CANONICAL_VENTURE_TEMPLATE.readiness.syntheticOutcomesForbidden).toBe(true)
  })

  test('factory validates only structural V002/V003 targets and rejects V001', () => {
    expect(validateVentureFactorySpec({
      ventureId: 'venture_002',
      name: 'Future Venture 002',
      type: 'saas',
      description: 'Structural shell only.',
      targetMarket: 'Validated future market',
      pricingModel: 'Validation-first pricing',
    })).toEqual([])
    expect(validateVentureFactorySpec({
      ventureId: 'venture_001',
      name: 'Invalid V001 regeneration',
      type: 'digital_product',
      description: 'Must be rejected.',
      targetMarket: 'Existing',
      pricingModel: 'Existing',
    }).some((error) => /Venture 001/i.test(error))).toBe(true)
  })

  test('V002/V003 factory is idempotent and creates structural-only shells', async () => {
    const results = await buildV002V003Factory([
      { ventureId: 'venture_002', name: 'Future Venture 002', type: 'saas', description: 'Structural V002 shell.', targetMarket: 'Future market', pricingModel: 'Validation-first' },
      { ventureId: 'venture_003', name: 'Future Venture 003', type: 'service', description: 'Structural V003 shell.', targetMarket: 'Future market', pricingModel: 'Validation-first' },
    ])
    expect(results).toHaveLength(2)
    expect(results.every((result) => result.created)).toBe(true)
    expect(results.every((result) => result.blueprint.lifecycleStage === 'proposed')).toBe(true)
    expect(await getVentureFactoryBlueprint('venture_002')).not.toBeNull()
    expect(await getVentureFactoryBlueprint('venture_003')).not.toBeNull()

    const second = await buildV002V003Factory([
      { ventureId: 'venture_002', name: 'Future Venture 002', type: 'saas', description: 'Structural V002 shell.', targetMarket: 'Future market', pricingModel: 'Validation-first' },
      { ventureId: 'venture_003', name: 'Future Venture 003', type: 'service', description: 'Structural V003 shell.', targetMarket: 'Future market', pricingModel: 'Validation-first' },
    ])
    expect(second.every((result) => !result.created && !result.repaired)).toBe(true)
  })

  test('autonomy manager refuses non-VID execution and does not manufacture readiness', async () => {
    await expect(runAutonomyManagerTick({ actorId: 'ceo', ventureIds: ['venture_001'] })).rejects.toThrow(/requires VID authority/i)
    const work = await enqueueAutonomyWork({ ventureId: 'venture_001', action: 'review readiness evidence', idempotencyKey: 'v001-readiness-14' })
    const duplicate = await enqueueAutonomyWork({ ventureId: 'venture_001', action: 'review readiness evidence', idempotencyKey: 'v001-readiness-14' })
    expect(duplicate.workId).toBe(work.workId)

    const run = await runAutonomyManagerTick({ actorId: 'vid', ventureIds: ['venture_001'], maxWorkItems: 10, now: new Date() })
    expect(run.status).not.toBe('FAILED')
    expect(run.leaseAcquired).toBe(true)
    expect(run.venturesChecked).toBe(1)
    expect(run.venturesReady).toBe(0)
    expect(run.venturesBlocked).toBe(1)
    expect(run.workBlocked).toBe(1)
    expect(run.workClaimed).toBe(0)

    const status = await getAutonomyManagerStatus()
    expect(status.recentRuns.length).toBeGreaterThan(0)
  })
})
