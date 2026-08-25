import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const exists = (path: string) => existsSync(resolve(root, path))

describe('Phases A-E structural integration', () => {
  test('canonical A-E control-plane files exist exactly where the architecture map declares them', () => {
    const canonicalFiles = [
      'src/lib/architecture-control-plane.ts',
      'src/lib/autonomy/autonomy-manager.ts',
      'src/lib/autonomy-graduation.ts',
      'src/lib/venture-autonomy-control.ts',
      'src/lib/venture-operation-loop.ts',
      'src/lib/operational-kpi-engine.ts',
      'src/lib/transaction-evidence-integrity.ts',
      'src/lib/venture-commercial-foundation.ts',
      'docs/ARCHITECTURE-CONTINUITY-MAP.md',
    ]
    for (const path of canonicalFiles) expect(exists(path)).toBe(true)
  })

  test('the canonical heartbeat and autonomy authority boundaries are singular and coordinated', () => {
    const heartbeat = read('src/lib/venture-operation-loop.ts')
    const manager = read('src/lib/autonomy/autonomy-manager.ts')
    const graduation = read('src/lib/autonomy-graduation.ts')
    const workflow = read('.github/workflows/autonomy-ci.yml')
    const continuity = read('docs/ARCHITECTURE-CONTINUITY-MAP.md')

    expect(heartbeat).toContain('runAutonomyManagerTick')
    expect(heartbeat).toContain('evaluateAndPersistAutonomy')
    expect(heartbeat).toContain('const mode = autonomyModeForLevel(autonomy.level)')
    expect(heartbeat).not.toContain("const mode: AutonomyMode = readiness.status === 'READY' ? 'AUTONOMOUS' : 'SUPERVISED'")
    expect(manager).toContain('canonical orchestration boundary')
    expect(graduation).toContain('ACTION_CLASS_CEILINGS')
    expect(graduation).toContain('approveFirstHighRiskGraduation')
    expect(workflow).toContain('tests/autonomy-graduation.integration.test.ts')
    expect(workflow).toContain('tests/phase-d-e-integration.test.ts')
    expect(workflow).toContain('tests/phase-a-e-structural-integrity.test.ts')
    expect(continuity).toContain('one canonical heartbeat')
    expect(continuity).toContain('autonomy-graduation.ts')
    expect(continuity).toContain('Do not create another architecture map for the same system.')
  })

  test('D-E policy is not duplicated into derived projections', () => {
    const continuity = read('docs/ARCHITECTURE-CONTINUITY-MAP.md')
    expect(continuity).toContain('Autonomy policy must remain centralized in the canonical graduation module')
    expect(continuity).toContain('derived UI/reporting may project it but may not redefine ceilings or approval rules')
  })
})
