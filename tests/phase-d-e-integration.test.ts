import { describe, expect, test } from 'bun:test'
import { autonomyModeForLevel, createVentureOperationCycleId } from '@/lib/venture-operation-loop'
import { getActionClassCeiling } from '@/lib/autonomy-graduation'

describe('Phase D-E heartbeat integration contracts', () => {
  test('execution mode is subordinate to canonical autonomy graduation', () => {
    expect(autonomyModeForLevel('PROPOSED')).toBe('SUPERVISED')
    expect(autonomyModeForLevel('ASSISTED')).toBe('SUPERVISED')
    expect(autonomyModeForLevel('SUPERVISED')).toBe('SUPERVISED')
    expect(autonomyModeForLevel('AUTONOMOUS')).toBe('AUTONOMOUS')
  })

  test('action-class ceilings remain authoritative across the heartbeat boundary', () => {
    expect(getActionClassCeiling('LOW_RISK')).toBe('AUTONOMOUS')
    expect(getActionClassCeiling('MEDIUM_RISK')).toBe('SUPERVISED')
    expect(getActionClassCeiling('HIGH_RISK')).toBe('SUPERVISED')
    expect(getActionClassCeiling('IRREVERSIBLE')).toBe('ASSISTED')
  })

  test('operation cycle ids are deterministic per execution and cannot collapse by minute', () => {
    const first = createVentureOperationCycleId('venture_001', 'run_1')
    const second = createVentureOperationCycleId('venture_001', 'run_2')
    expect(first).not.toBe(second)
    expect(createVentureOperationCycleId('venture_001', 'run_1')).toBe(first)
    expect(() => createVentureOperationCycleId('', 'run_1')).toThrow('required')
    expect(() => createVentureOperationCycleId('venture_001', '')).toThrow('required')
  })
})
