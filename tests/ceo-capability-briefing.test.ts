import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderCeoCapabilityBriefing } from '@/lib/ceo-capability-briefing'
import { buildCeoContextModules, composeCeoContext } from '@/lib/ceo-context-composer'

const ROOT = join(import.meta.dir, '..')

describe('renderCeoCapabilityBriefing', () => {
  const savedGroq = process.env.GROQ_API_KEY
  const savedMistral = process.env.MISTRAL_API_KEY

  afterEach(() => {
    if (savedGroq === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = savedGroq
    if (savedMistral === undefined) delete process.env.MISTRAL_API_KEY; else process.env.MISTRAL_API_KEY = savedMistral
  })

  test('describes the real, bounded document/transcription/review capabilities honestly', () => {
    const briefing = renderCeoCapabilityBriefing()
    expect(briefing).toContain('PDF')
    expect(briefing).toContain('DOCX')
    expect(briefing).toContain('XLSX')
    expect(briefing).toContain('PPTX')
    expect(briefing).toContain('200MB')
    expect(briefing).toContain('5MB')
    expect(briefing).toContain('avi, mov, mkv')
    expect(briefing).toContain('reviewed / approved / flagged / corrected / closed')
  })

  test('never overclaims universal file support', () => {
    const briefing = renderCeoCapabilityBriefing()
    expect(briefing.toLowerCase()).not.toContain('any type of file')
    expect(briefing.toLowerCase()).not.toContain('any file type')
  })

  test('honestly reports transcription as unconfigured when GROQ_API_KEY is absent', () => {
    delete process.env.GROQ_API_KEY
    const briefing = renderCeoCapabilityBriefing()
    expect(briefing).toContain('NOT currently configured in this environment (requires GROQ_API_KEY)')
  })

  test('reports transcription as available when GROQ_API_KEY is configured', () => {
    process.env.GROQ_API_KEY = 'test-key'
    const briefing = renderCeoCapabilityBriefing()
    expect(briefing).toContain('configured and available')
  })

  test('honestly reports semantic search as keyword-only when MISTRAL_API_KEY is absent', () => {
    delete process.env.MISTRAL_API_KEY
    const briefing = renderCeoCapabilityBriefing()
    expect(briefing).toContain('keyword matching only in this environment')
  })

  test('reports semantic search as configured when MISTRAL_API_KEY is present', () => {
    process.env.MISTRAL_API_KEY = 'test-key'
    const briefing = renderCeoCapabilityBriefing()
    expect(briefing).toContain('embedding-based semantic recovery (configured)')
  })
})

describe('buildCeoContextModules / composeCeoContext: capability_briefing module policy', () => {
  const rows = [
    { role: 'user' as const, content: 'Hello there', createdAt: 0 },
    { role: 'assistant' as const, content: 'Hi! How can I help?', createdAt: 1 },
  ]

  test('omits the capability_briefing module when no briefing was supplied', () => {
    const modules = buildCeoContextModules({ intent: 'conversation', missionRelevant: false, evidenceClass: 'none', executionRequirement: 'standard' })
    expect(modules.capabilityBriefing).toBeUndefined()
  })

  test('includes the trimmed briefing when supplied', () => {
    const modules = buildCeoContextModules({ intent: 'conversation', missionRelevant: false, evidenceClass: 'none', executionRequirement: 'standard', capabilityBriefing: '  CEO CAPABILITY BRIEFING: real facts here.  ' })
    expect(modules.capabilityBriefing).toBe('CEO CAPABILITY BRIEFING: real facts here.')
  })

  test('composeCeoContext renders no capability-briefing message when the module is absent', async () => {
    const composed = await composeCeoContext({ systemPrompt: 'sys', currentUserMessage: 'Hello there', persistedMessages: rows, memories: [] })
    expect(composed.modules).not.toContain('capability_briefing')
    expect(composed.messages.some((message) => message.content.includes('CEO CAPABILITY BRIEFING'))).toBe(false)
  })

  test('composeCeoContext renders the briefing verbatim as a system message when present', async () => {
    const composed = await composeCeoContext({
      systemPrompt: 'sys',
      currentUserMessage: 'What are your capabilities and limitations?',
      persistedMessages: rows,
      memories: [],
      modules: { capabilityBriefing: renderCeoCapabilityBriefing() },
    })
    expect(composed.modules).toContain('capability_briefing')
    const briefingMessage = composed.messages.find((message) => message.content.includes('CEO CAPABILITY BRIEFING'))
    expect(briefingMessage?.content).toContain('PDF')
  })
})

describe('route.ts wiring: capability briefing gated on capability_assessment', () => {
  const source = readFileSync(join(ROOT, 'src/app/api/agent/route.ts'), 'utf-8')

  test('imports and computes the briefing gated on the capability_assessment self-reflection kind', () => {
    expect(source).toContain("import { renderCeoCapabilityBriefing } from '@/lib/ceo-capability-briefing'")
    expect(source).toContain("executionContract.selfReflectionKind === 'capability_assessment' ? renderCeoCapabilityBriefing() : undefined")
  })

  test('threads capabilityBriefing into all three buildCeoContextModules call sites', () => {
    expect(source.match(/capabilityBriefing: capabilityBriefingContext/g)?.length ?? 0).toBe(3)
  })
})
