import { describe, expect, test } from 'bun:test'
import { executionProofText, requireExecutionProof, resolveExecutionScope } from '@/lib/execution-contract'

describe('Phase 1 — truthful execution contract', () => {
  test('keeps real mission identity when available', () => {
    expect(resolveExecutionScope({ missionId: 'mission-123', requestHash: 'a'.repeat(64) })).toEqual({
      missionId: 'mission-123',
      scope: 'mission',
    })
  })

  test('uses explicit unscoped identity when no mission exists', () => {
    expect(resolveExecutionScope({ conversationId: 'conversation-123', requestHash: 'a'.repeat(64) })).toEqual({
      missionId: 'unscoped:conversation-123',
      scope: 'unscoped',
    })
  })

  test('proof text exposes persisted receipt identity and state', () => {
    const text = executionProofText({
      receiptId: 'receipt-1',
      missionId: 'mission-1',
      scope: 'mission',
      status: 'SUCCESS',
      requestHash: 'a'.repeat(64),
    })
    expect(text).toContain('receipt=receipt-1')
    expect(text).toContain('status=SUCCESS')
  })

  test('execution claims require an actual receipt', () => {
    expect(() => requireExecutionProof(undefined)).toThrow('EXECUTION_CONTRACT_VIOLATION')
  })
})
