import { describe, expect, test } from 'bun:test'
import { buildOrchestratorExecutionSummary } from '@/lib/orchestrator-execution-contract'

describe('orchestrator execution contract', () => {
  test('builds bounded internal evidence without presenting it as a user answer', () => {
    const summary = buildOrchestratorExecutionSummary({
      executionStatus: 'completed',
      completionReason: 'done',
      toolSteps: [
        {
          toolName: 'send_email',
          toolResult: { ok: true, result: 'message_id: abc123' },
          verification: { verified: true, artifactType: 'message_id' },
        },
      ],
      notes: ['subagent output: completed the requested validation'],
    })
    expect(summary).toContain('INTERNAL ORCHESTRATION RECEIPT — NOT USER-FACING')
    expect(summary).toContain('Execution status: completed')
    expect(summary).toContain('send_email: OK')
    expect(summary).toContain('verified=message_id')
    expect(summary).not.toContain('## Final Answer')
    expect(summary.length).toBeLessThanOrEqual(18000)
  })

  test('renders explicit VERIFY failure state into the CEO receipt', () => {
    const summary = buildOrchestratorExecutionSummary({
      executionStatus: 'completed',
      completionReason: 'done',
      toolSteps: [{
        toolName: 'send_email',
        toolResult: { ok: true, result: 'sent' },
        verification: { verified: false, artifactType: 'none', warning: 'No message id found.' },
      }],
    })
    expect(summary).toContain('verification=UNVERIFIED')
    expect(summary).toContain('No message id found.')
  })

  test('records failed execution distinctly from completion', () => {
    const summary = buildOrchestratorExecutionSummary({
      executionStatus: 'failed',
      completionReason: 'llm_error',
      terminalError: 'provider unavailable',
      toolSteps: [],
    })
    expect(summary).toContain('Execution status: failed')
    expect(summary).toContain('Completion reason: llm_error')
    expect(summary).toContain('provider unavailable')
  })
})
