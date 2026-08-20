import { describe, expect, test } from 'bun:test'
import { dispatchTool } from './tools-runtime'

describe('Canonical tool dispatch autonomy boundary', () => {
  const ctx = { attachments: [], language: 'en' as const }

  test('allows a registered autonomous read through the boundary and returns execution proof', async () => {
    const result = await dispatchTool('web_search', { query: '' }, ctx)
    expect(result.result).toContain('Missing "query" argument for web_search')
    expect(result.executionProof?.receiptId).toBeTruthy()
    expect(result.executionProof?.status).toBe('FAILED')
    expect(result.executionProof?.scope).toBe('unscoped')
  })

  test('blocks arbitrary write tools before execution and returns a denial receipt', async () => {
    const result = await dispatchTool('file_create', { path: 'tmp.txt', content: 'x' }, ctx)
    expect(result.ok).toBe(false)
    expect(result.result).toContain('AUTONOMY GOVERNOR')
    expect(result.result).toContain('Owner approval')
    expect(result.executionProof?.status).toBe('DENIED')
    expect(result.executionProof?.receiptId).toBeTruthy()
  })

  test('forbids destructive tools before execution', async () => {
    const result = await dispatchTool('file_delete', { path: 'tmp.txt' }, ctx)
    expect(result.ok).toBe(false)
    expect(result.result).toContain('AUTONOMY GOVERNOR')
    expect(result.result).toContain('FORBIDDEN')
    expect(result.executionProof?.status).toBe('DENIED')
  })

  test('keeps internal mission bookkeeping autonomous', async () => {
    const result = await dispatchTool('report_progress', { status: 'testing' }, ctx)
    expect(result.result).not.toContain('AUTONOMY GOVERNOR: Tool "report_progress" was not authorized')
    expect(result.executionProof?.receiptId).toBeTruthy()
  })

  test('blocks arbitrary code execution before the underlying tool runs', async () => {
    const result = await dispatchTool('code_exec', { code: 'return 1' }, ctx)
    expect(result.ok).toBe(false)
    expect(result.result).toContain('AUTONOMY GOVERNOR')
    expect(result.result).toContain('Owner approval')
    expect(result.executionProof?.status).toBe('DENIED')
  })
})
