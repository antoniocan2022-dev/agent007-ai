/**
 * leader-debate.ts — UPGRADE #209
 *
 * Leader Debate Protocol — dispatches multiple leaders in parallel for
 * high-stakes decisions, then synthesizes their recommendations into
 * a unified executive decision with confidence breakdown.
 *
 * Instead of one leader making decisions:
 *   User → Finance Leader → Answer
 *
 * Multiple leaders debate:
 *   User → Finance + Risk + Legal + Research → Executive Brain → Decision
 *
 * Each leader returns:
 *   - Recommendation
 *   - Confidence (0-100%)
 *   - Evidence (what data/sources they used)
 *   - Risk assessment
 *
 * The Executive Brain resolves disagreements and presents a unified decision.
 */

import { dispatchTool } from './tools'
import { callLlmWithRetry } from './agent'

export const runtime = 'nodejs'
export const maxDuration = 120

export interface DebateResponse {
  leader: string
  recommendation: string
  confidence: number
  evidence: string[]
  risk: string
}

export interface DebateResult {
  topic: string
  responses: DebateResponse[]
  executiveDecision: string
  overallConfidence: number
  disagreements: string[]
  consensus: boolean
}

/**
 * Run a leader debate on a high-stakes question.
 *
 * @param topic - The question to debate (e.g., "Should I invest $5K in Tesla?")
 * @param leaders - Array of leader IDs to include (e.g., ['quantum', 'echo', 'legal'])
 * @returns DebateResult with all responses + executive synthesis
 */
export async function runLeaderDebate(
  topic: string,
  leaders: string[] = ['quantum', 'echo', 'legal']
): Promise<DebateResult> {
  console.log(`[leader-debate] Starting debate on: "${topic}"`)
  console.log(`[leader-debate] Leaders: ${leaders.join(', ')}`)

  // ═══ PHASE 1: Dispatch all leaders in parallel ═══
  const dispatches = await Promise.allSettled(
    leaders.map(leaderId =>
      dispatchTool('web_search', {
        query: `${topic} ${leaderId} perspective analysis`,
      }, { attachments: [], language: 'en' }).catch(() => null)
    )
  )

  // ═══ PHASE 2: Parse each leader's response ═══
  const responses: DebateResponse[] = []

  for (let i = 0; i < leaders.length; i++) {
    const leaderId = leaders[i]
    const dispatchResult = dispatches[i] as any
    const result = dispatchResult.status === 'fulfilled' ? dispatchResult.value : null

    // Generate leader-specific perspective via LLM
    const leaderPrompt = `You are ${leaderId.toUpperCase()}, a specialist in the Agent007 AI system.
A strategic question has been raised: "${topic}"

Based on your specialty, provide:
1. RECOMMENDATION: What do you recommend? (1-2 sentences)
2. CONFIDENCE: Your confidence level (0-100%)
3. EVIDENCE: What data/sources support this? (list 2-3 items)
4. RISK: What's the main risk?

Format your response as:
RECOMMENDATION: <text>
CONFIDENCE: <number>%
EVIDENCE: <item1>, <item2>, <item3>
RISK: <text>`

    let leaderResponse = ''
    try {
      const completion = await callLlmWithRetry([
        { role: 'system', content: leaderPrompt },
        { role: 'user', content: `Topic: ${topic}\nSearch context: ${(result?.result || '').slice(0, 1000)}` },
      ])
      leaderResponse = completion?.choices?.[0]?.message?.content || ''
    } catch {
      leaderResponse = 'RECOMMENDATION: Unable to analyze\nCONFIDENCE: 0%\nEVIDENCE: none\nRISK: analysis failed'
    }

    // Parse the response
    const parsed: DebateResponse = {
      leader: leaderId,
      recommendation: extractField(leaderResponse, 'RECOMMENDATION') || 'No recommendation',
      confidence: parseInt(extractField(leaderResponse, 'CONFIDENCE') || '0'),
      evidence: (extractField(leaderResponse, 'EVIDENCE') || '').split(',').map(s => s.trim()).filter(Boolean),
      risk: extractField(leaderResponse, 'RISK') || 'Unknown risk',
    }
    responses.push(parsed)
    console.log(`[leader-debate] ${leaderId}: ${parsed.confidence}% confidence`)
  }

  // ═══ PHASE 3: Executive Brain synthesizes ═══
  console.log('[leader-debate] Phase 3: Executive synthesis...')

  const synthesisPrompt = `You are the Executive Brain of Agent007 AI. Multiple specialist leaders have debated the topic: "${topic}"

Here are their responses:
${responses.map(r => `
${r.leader.toUpperCase()}:
  Recommendation: ${r.recommendation}
  Confidence: ${r.confidence}%
  Evidence: ${r.evidence.join(', ')}
  Risk: ${r.risk}
`).join('\n')}

As the Executive Brain, synthesize these into:
1. EXECUTIVE DECISION: What is the unified recommendation? (2-3 sentences)
2. OVERALL CONFIDENCE: What's the combined confidence? (0-100%)
3. DISAGREEMENTS: Where do the leaders disagree? (list, or "none" if consensus)
4. CONSENSUS: Did they reach consensus? (yes/no)

Format:
EXECUTIVE_DECISION: <text>
OVERALL_CONFIDENCE: <number>%
DISAGREEMENTS: <text or none>
CONSENSUS: <yes/no>`

  let execResponse = ''
  try {
    const completion = await callLlmWithRetry([
      { role: 'system', content: synthesisPrompt },
      { role: 'user', content: 'Synthesize the debate.' },
    ])
    execResponse = completion?.choices?.[0]?.message?.content || ''
  } catch {
    execResponse = 'EXECUTIVE_DECISION: Synthesis failed\nOVERALL_CONFIDENCE: 0%\nDISAGREEMENTS: unknown\nCONSENSUS: no'
  }

  const result: DebateResult = {
    topic,
    responses,
    executiveDecision: extractField(execResponse, 'EXECUTIVE_DECISION') || 'No decision',
    overallConfidence: parseInt(extractField(execResponse, 'OVERALL_CONFIDENCE') || '0'),
    disagreements: (extractField(execResponse, 'DISAGREEMENTS') || 'none').split('\n').filter(d => d.toLowerCase() !== 'none'),
    consensus: (extractField(execResponse, 'CONSENSUS') || 'no').toLowerCase().startsWith('y'),
  }

  console.log(`[leader-debate] Complete. Consensus: ${result.consensus}, Confidence: ${result.overallConfidence}%`)
  return result
}

function extractField(text: string, field: string): string | null {
  const rx = new RegExp(`${field}:\\s*(.+?)(?:\\n[A-Z_]+:|$)`, 'is')
  const m = text.match(rx)
  return m ? m[1].trim() : null
}
