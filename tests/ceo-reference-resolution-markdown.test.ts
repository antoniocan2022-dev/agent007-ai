import { describe, expect, test } from 'bun:test'
import { extractEnumeratedItems, resolveOrdinalReference } from '@/lib/ceo-reference-resolution'
import type { PersistedConversationRow } from '@/lib/ceo-context-composer'

function row(role: 'user' | 'assistant', content: string, createdAt = Date.now()): PersistedConversationRow { return { role, content, createdAt } }

// Deep-audit finding, reproduced directly against extractEnumeratedItems before this fix existed:
// ordinary LLM output routinely bold-wraps a numbered list item's label -- "**1. Title**" or
// "**1. Title:** description" are standard markdown, not edge cases -- but the numbered-line matcher
// required a bare digit at the start of the line, so a bold-formatted list produced zero extracted
// items every time. A real production transcript hit this exactly: the CEO gave a clean 2-item list,
// the user asked "Explain the second one in more depth," and resolveOrdinalReference had nothing to
// resolve, forcing an unnecessary clarification request on a completely unambiguous reference.
describe('extractEnumeratedItems / resolveOrdinalReference against markdown-formatted lists', () => {
  const question = 'Give me two options for improving retention.'
  const plainReply = `1. Customer Retention: Conduct a Friction Audit of the Onboarding Funnel
Churn is frequently caused by cumulative micro-frustrations.

2. Employee Retention: Prioritize Growth Visibility and Structural Health
Top talent often leaves when they lack a clear sense of progression.`
  const wholeLineBoldReply = `**1. Customer Retention: Conduct a Friction Audit of the Onboarding Funnel**
Churn is frequently caused by cumulative micro-frustrations.

**2. Employee Retention: Prioritize Growth Visibility and Structural Health**
Top talent often leaves when they lack a clear sense of progression.`
  const labelOnlyBoldReply = `**1. Customer Retention:** Conduct a Friction Audit of the Onboarding Funnel
**2. Employee Retention:** Prioritize Growth Visibility and Structural Health`

  test('a plain, unformatted numbered list resolves correctly (baseline, not a regression)', () => {
    const rows = [row('user', question), row('assistant', plainReply)]
    const items = extractEnumeratedItems(rows)
    expect(items.map((item) => item.ordinal)).toEqual([1, 2])
    const resolved = resolveOrdinalReference('Explain the second one in more depth.', rows)
    expect(resolved?.ambiguous).toBe(false)
    expect(resolved?.resolvedText).toContain('Employee Retention')
  })

  test('a whole-line bold-wrapped numbered list resolves correctly', () => {
    const rows = [row('user', question), row('assistant', wholeLineBoldReply)]
    const items = extractEnumeratedItems(rows)
    expect(items.map((item) => item.ordinal)).toEqual([1, 2])
    expect(items[0]?.text).toBe('Customer Retention: Conduct a Friction Audit of the Onboarding Funnel')
    const resolved = resolveOrdinalReference('Explain the second one in more depth.', rows)
    expect(resolved?.ambiguous).toBe(false)
    expect(resolved?.confidence).toBeGreaterThanOrEqual(0.9)
    expect(resolved?.resolvedText).toContain('Employee Retention')
  })

  test('a label-only bold-wrapped numbered list (bold closes mid-line) resolves correctly', () => {
    const rows = [row('user', question), row('assistant', labelOnlyBoldReply)]
    const items = extractEnumeratedItems(rows)
    expect(items.map((item) => item.ordinal)).toEqual([1, 2])
    const resolved = resolveOrdinalReference('Explain the first one in more depth.', rows)
    expect(resolved?.ambiguous).toBe(false)
    expect(resolved?.resolvedText).toContain('Customer Retention')
  })

  test('the first/last ordinals also resolve correctly against a bold list, not just second', () => {
    const rows = [row('user', question), row('assistant', wholeLineBoldReply)]
    expect(resolveOrdinalReference('the first one', rows)?.resolvedText).toContain('Customer Retention')
    expect(resolveOrdinalReference('the last option', rows)?.resolvedText).toContain('Employee Retention')
  })

  test('a genuinely missing list still resolves as ambiguous, not silently fabricated', () => {
    const rows = [row('user', 'What do you think is our biggest risk?'), row('assistant', 'Execution risk, not strategy risk.')]
    const resolved = resolveOrdinalReference('Explain the second one in more depth.', rows)
    expect(resolved?.ambiguous).toBe(true)
    expect(resolved?.resolvedText).toBeNull()
  })
})
