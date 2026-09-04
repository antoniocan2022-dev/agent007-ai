import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '..')

describe('Risk-abstention domain wiring, found during post-deployment verification', () => {
  test('the lifecycle passes the already-computed domain classification into buildCeoDegradedResponse, rather than leaving the risk-abstention system to fall back on crude keyword inference every time', () => {
    const source = readFileSync(join(ROOT, 'src/lib/ceo-cognitive-lifecycle.ts'), 'utf-8')
    const callSite = source.split('\n').find((line) => line.includes('buildCeoDegradedResponse({'))
    expect(callSite).toBeDefined()
    expect(callSite).toContain('domain: decisionPlan.executionContract.domain')
  })
})
