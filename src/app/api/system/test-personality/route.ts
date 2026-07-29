import { NextResponse } from 'next/server'
import { SYSTEM_PROMPT, callLlmWithRetry, friendlyLlmError } from '@/lib/agent'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/system/test-personality
 *
 * TEMPORARY unauthenticated endpoint to verify the new SYSTEM_PROMPT
 * (UPGRADE #171 — WHO YOU ARE + AI cliché ban + forever memory).
 *
 * Sends a fixed test question to the LLM with the new SYSTEM_PROMPT
 * and returns the response. Used to verify the personality fix is live.
 *
 * SECURITY: This endpoint costs LLM tokens but does NOT expose any
 * user data or secrets. It only tests the public SYSTEM_PROMPT and a
 * fixed question. Will be deleted after verification.
 *
 * Body: { question?: string }  (default: "What are your strengths?")
 */

const DEFAULT_QUESTION = "What are your strengths and weaknesses? What can I do to make the best of our partnership?"

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const question = (body?.question ?? DEFAULT_QUESTION).toString().slice(0, 500)

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: question },
  ]

  const start = Date.now()
  try {
    const result = await callLlmWithRetry(messages)
    const content = result?.choices?.[0]?.message?.content ?? ''
    const provider = result?._provider ?? 'unknown'
    const model = result?.model ?? 'unknown'
    const elapsed = Date.now() - start

    // Cliche detection — flag any banned phrase
    const bannedPhrases = [
      'human intuition can offer insights beyond data',
      'areas where I might fall short',
      'humans possess nuances',
      'trust your instincts alongside',
      'data inputs I have access to',
      'I rely on data and algorithms',
      'as an AI language model',
      'I cannot truly understand emotions',
    ]
    const lower = content.toLowerCase()
    const clichesFound = bannedPhrases.filter(p => lower.includes(p.toLowerCase()))

    // Capability detection — verify the new prompt's mandates are followed
    const expectedCapabilities = ['SCOUT', 'AURORA', 'ECHO', 'FORGE', 'PULSE', 'QUANTUM', 'pod leader', 'mission mode', 'accuracy_checker', 'persistent memory', '673', '20K']
    const capabilitiesMentioned = expectedCapabilities.filter(c => lower.includes(c.toLowerCase()))

    return NextResponse.json({
      ok: true,
      elapsed_ms: elapsed,
      provider,
      model,
      question,
      answer: content,
      personality_audit: {
        cliches_found: clichesFound,
        cliches_count: clichesFound.length,
        cliches_pass: clichesFound.length === 0,
        capabilities_mentioned: capabilitiesMentioned,
        capabilities_count: capabilitiesMentioned.length,
        capabilities_pass: capabilitiesMentioned.length >= 3,
      },
      overall_pass: clichesFound.length === 0 && capabilitiesMentioned.length >= 3,
    })
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: friendlyLlmError(e),
      raw_error: (e?.message ?? String(e)).slice(0, 200),
      elapsed_ms: Date.now() - start,
    }, { status: 500 })
  }
}
