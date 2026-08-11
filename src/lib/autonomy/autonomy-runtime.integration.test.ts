import { describe, expect, test } from 'bun:test'
import { classifyToolExecution } from './autonomy-runtime'

describe('Autonomy Governor integration invariants', () => {
  test('unknown writes never become autonomous from confidence alone', () => {
    const decision = classifyToolExecution('unknown_write_tool', { value: 1 }, {
      policyApproved: false,
      confidence: 1,
    })
    expect(decision.autonomous).toBe(false)
    expect(decision.requiresOwnerApproval).toBe(true)
  })

  test('destructive actions remain forbidden even with approval evidence', () => {
    const decision = classifyToolExecution('file_delete', { path: 'tmp.txt' }, {
      policyApproved: true,
      confidence: 1,
    })
    expect(decision.authority).toBe('FORBIDDEN')
    expect(decision.autonomous).toBe(false)
  })
})
