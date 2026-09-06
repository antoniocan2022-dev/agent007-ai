import { describe, expect, test } from 'bun:test'
import { projectCeoConversationForPublic } from '../src/lib/ceo-conversation-public-projection'

describe('CEO public conversation projection', () => {
  test('returns only user and assistant transcript rows', () => {
    const projected = projectCeoConversationForPublic([
      { id: 'u1', role: 'user', content: 'Hello', createdAt: new Date('2026-09-01T10:00:00Z'), attachments: JSON.stringify([{ filename: 'a.txt', dataUrl: 'secret', textContent: 'safe text' }]) },
      { id: 't1', role: 'thought', content: 'private chain of thought', createdAt: new Date('2026-09-01T10:00:01Z'), attachments: null },
      { id: 'tool1', role: 'tool', content: 'private tool result', createdAt: new Date('2026-09-01T10:00:02Z'), attachments: null },
      { id: 'a1', role: 'assistant', content: 'Final answer', createdAt: new Date('2026-09-01T10:00:03Z'), attachments: null },
    ])
    expect(projected.map((row) => ({ id: row.id, role: row.role, content: row.content }))).toEqual([
      { id: 'u1', role: 'user', content: 'Hello' },
      { id: 'a1', role: 'assistant', content: 'Final answer' },
    ])
  })

  test('removes attachment data URLs while retaining bounded user attachment metadata', () => {
    const projected = projectCeoConversationForPublic([
      { id: 'u1', role: 'user', content: 'Upload', createdAt: new Date(), attachments: JSON.stringify([{ filename: 'a.txt', originalName: 'a.txt', mimeType: 'text/plain', size: 10, dataUrl: 'secret', textContent: 'x'.repeat(10000) }]) },
    ])
    expect(projected[0]?.attachments).toEqual([{ filename: 'a.txt', originalName: 'a.txt', mimeType: 'text/plain', size: 10, textContent: 'x'.repeat(8000) }])
    expect(JSON.stringify(projected)).not.toContain('dataUrl')
    expect(JSON.stringify(projected)).not.toContain('secret')
  })

  test('excludes a historically poisoned assistant row from the reload surface instead of serving it to the browser as-is', () => {
    const projected = projectCeoConversationForPublic([
      { id: 'u1', role: 'user', content: 'Analyze the psychological patterns affecting my business decisions.', createdAt: new Date('2026-09-01T10:00:00Z'), attachments: null },
      { id: 'a1', role: 'assistant', content: 'Here is my analysis. [continuous_loop_trace] continuous_loop:continuous_loop_abc123: {"schemaVersion":1,"currentStage":"PERCEIVE"}', createdAt: new Date('2026-09-01T10:00:01Z'), attachments: null },
      { id: 'a2', role: 'assistant', content: 'A clean, real answer with no internal artifacts.', createdAt: new Date('2026-09-01T10:00:02Z'), attachments: null },
    ])
    expect(projected.map((row) => row.id)).toEqual(['u1', 'a2'])
  })
})
