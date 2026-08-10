import { describe, expect, test } from 'bun:test'
import { dispatchTool } from './tools-runtime'

describe('Canonical tool dispatch autonomy boundary', () => {
  const ctx = { attachments: [], language: 'en' as const }

  test('allows an explicitly policy-approved read through the boundary', async () => {
    const result = await dispatchTool('web_search', { query: '' }, ctx)
    // The empty query reaches the real tool and is rejected for its argument,
    // which proves the autonomy boundary did not block the read first.
    expect(result.result).toContain('Missing "query" argument for web_search')
  })

  test('blocks arbitrary write tools before execution', async () => {
    const result = await dispatchTool('file_create', { path: 'tmp.txt', content: 'x' }, ctx)
    expect(result.ok).toBe(false)
    expect(result.result).toContain('AUTONOMY GOVERNOR')
    expect(result.result).toContain('Owner approval')
  })

  test('forbids destructive tools before execution', async () => {
    const result = await dispatchTool('file_delete', { path: 'tmp.txt' }, ctx)
    expect(result.ok).toBe(false)
    expect(result.result).toContain('AUTONOMY GOVERNOR')
    expect(result.result).toContain('FORBIDDEN')
  })

  test('keeps internal mission bookkeeping autonomous', async () => {
    const result = await dispatchTool('report_progress', { status: 'testing' }, ctx)
    // The exact implementation may reject malformed/incomplete arguments,
    // but it must not be rejected by the Autonomy Governor itself.
    expect(result.result).not.toContain('AUTONOMY GOVERNOR: Tool "report_progress" was not authorized')
  })
})
