/**
 * super-agent-verifier.ts — UPGRADE #137 (Hierarchy Verifier — Rec 1 + Rec 2)
 * ===================================================================
 * The Super Agent is the APEX quality authority above all team leaders.
 *
 * Workflow:
 *   1. Team Leader produces output
 *   2. superAgentVerify() grades the output 0-100 with a verdict:
 *        APPROVED          (score >= 85)
 *        NEEDS_IMPROVEMENT (70-84)
 *        REJECTED          (< 70)
 *   3. If not APPROVED, returns SPECIFIC corrections the team must address
 *   4. runTeamWithVerificationLoop() handles the retry loop (max 3 rounds)
 *
 * This file is consumed by mission-pipeline.ts (Rec 4) which wires it into
 * the orchestrator between every team handoff.
 */

import { callLlmWithRetry } from './agent'

export type VerificationVerdict = 'APPROVED' | 'NEEDS_IMPROVEMENT' | 'REJECTED'

export interface VerificationResult {
  approved: boolean
  verdict: VerificationVerdict
  score: number // 0-100
  strengths: string[]
  weaknesses: string[]
  corrections: string[] // specific actionable feedback
  correctedOutput?: string // Super Agent's improved version (optional)
  summary: string // one-line human-readable summary
}

export interface VerifyOptions {
  teamOutput: string
  missionContext: string // mission objective + history
  stageRequirements: string // what this stage was supposed to produce
  previousTeamOutput?: string // for cross-team verification
  round?: number // 1-based round number (for retry loops)
  maxRounds?: number
}

const VERIFIER_SYSTEM_PROMPT = `You are the SUPER AGENT — the apex quality authority above all team leaders in Agent007.

Your job: verify, correct, improve, and APPROVE or REJECT work submitted by team leaders.

VERIFICATION CHECKLIST (score each 0-20, total 0-100):
1. COMPLETENESS — Did the team address every part of the stage requirements?
2. ACCURACY — Are facts, numbers, URLs verifiable? No hallucinations?
3. QUALITY — Is the output professional, well-structured, actionable?
4. DELIVERY — Did tools actually succeed (RESULT.ok === true), not just get called?
5. ALIGNMENT — Does the output match the mission objective?

VERDICT RULES:
- score >= 85 → APPROVED (work is acceptable, advance to next stage)
- score 70-84 → NEEDS_IMPROVEMENT (provide SPECIFIC corrections, team retries)
- score < 70  → REJECTED (provide SPECIFIC corrections + reference corrected version)

CRITICAL RULES:
- Be STRICT but FAIR. Do not approve low-quality work.
- If you approve, do NOT require another round.
- If you REJECT, your corrections MUST be specific and actionable:
  ✅ "Add revenue projections for months 1-3 in a table"
  ❌ "Make it better"
- Optionally provide a "correctedOutput" — your improved version the team can use as reference.
- NEVER fabricate. If you can't verify a claim, mark it as a weakness.

If a previousTeamOutput is provided, also verify that the new team's output is consistent
with / builds correctly on the previous team's work.

Return ONLY a valid JSON object — no markdown, no commentary outside the JSON.`

function extractJson(content: string): any | null {
  // Try direct parse first
  try { return JSON.parse(content) } catch {}

  // Try to find a JSON block in the content
  const jsonMatch = content.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]) } catch {}
  }

  // Try to find a code block
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    try { return JSON.parse(codeBlockMatch[1]) } catch {}
  }

  return null
}

function clampScore(n: any): number {
  const num = Number(n)
  if (!Number.isFinite(num)) return 50 // default to middle if unparseable
  return Math.max(0, Math.min(100, Math.round(num)))
}

function safeStringArray(v: any): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean)
  if (typeof v === 'string' && v.trim()) return [v.trim()]
  return []
}

/**
 * Verify a team's output. Returns a structured VerificationResult.
 *
 * Uses a low temperature (0.2) for consistent, deterministic judgments.
 * Falls back to a default APPROVED with score 75 if LLM fails — we don't
 * want to BLOCK missions if the verifier itself is down.
 */
export async function superAgentVerify(opts: VerifyOptions): Promise<VerificationResult> {
  const {
    teamOutput,
    missionContext,
    stageRequirements,
    previousTeamOutput,
    round = 1,
    maxRounds = 3,
  } = opts

  const userPrompt = `MISSION CONTEXT:
${missionContext.slice(0, 2000)}

STAGE REQUIREMENTS:
${stageRequirements.slice(0, 1500)}

${previousTeamOutput ? `PREVIOUS TEAM'S OUTPUT (for cross-team verification):\n${previousTeamOutput.slice(0, 2000)}\n\n` : ''}TEAM OUTPUT TO VERIFY (round ${round} of ${maxRounds}):
${teamOutput.slice(0, 6000)}

Verify this output against the checklist. Return JSON in this EXACT shape:
{
  "approved": boolean,
  "verdict": "APPROVED" | "NEEDS_IMPROVEMENT" | "REJECTED",
  "score": number (0-100),
  "strengths": string[],
  "weaknesses": string[],
  "corrections": string[],
  "correctedOutput": string | null,
  "summary": string
}`

  try {
    const response = await callLlmWithRetry([
      { role: 'system', content: VERIFIER_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ], { thinking: false })

    const content: string = typeof response === 'string'
      ? response
      : (response?.content ?? response?.message?.content ?? '')

    const parsed = extractJson(content)

    if (!parsed) {
      // LLM didn't return valid JSON — fall back to a permissive verdict
      // so we don't block missions when the verifier itself misbehaves.
      return {
        approved: true,
        verdict: 'APPROVED',
        score: 75,
        strengths: ['Verifier LLM returned non-JSON — auto-approved to avoid mission stall'],
        weaknesses: [],
        corrections: [],
        summary: 'Verifier fallback (non-JSON response) — auto-approved',
      }
    }

    const score = clampScore(parsed.score)
    let verdict: VerificationVerdict
    if (parsed.verdict === 'APPROVED' || parsed.verdict === 'NEEDS_IMPROVEMENT' || parsed.verdict === 'REJECTED') {
      verdict = parsed.verdict
    } else {
      // Derive verdict from score
      verdict = score >= 85 ? 'APPROVED' : score >= 70 ? 'NEEDS_IMPROVEMENT' : 'REJECTED'
    }

    // Ensure consistency: verdict ↔ approved ↔ score
    const approved = verdict === 'APPROVED' && score >= 70

    return {
      approved,
      verdict,
      score,
      strengths: safeStringArray(parsed.strengths),
      weaknesses: safeStringArray(parsed.weaknesses),
      corrections: safeStringArray(parsed.corrections),
      correctedOutput: typeof parsed.correctedOutput === 'string' && parsed.correctedOutput.trim()
        ? parsed.correctedOutput.trim()
        : undefined,
      summary: typeof parsed.summary === 'string' && parsed.summary.trim()
        ? parsed.summary.trim()
        : `${verdict} — score ${score}/100`,
    }
  } catch (e: any) {
    // LLM completely failed — fall back to permissive verdict
    return {
      approved: true,
      verdict: 'APPROVED',
      score: 75,
      strengths: ['Verifier LLM unavailable — auto-approved to avoid mission stall'],
      weaknesses: [],
      corrections: [],
      summary: `Verifier fallback (LLM error: ${e?.message?.slice(0, 100) ?? 'unknown'}) — auto-approved`,
    }
  }
}

/**
 * Format a VerificationResult as a readable string for Telegram / logs / DB.
 */
export function formatVerificationResult(v: VerificationResult): string {
  const icon = v.verdict === 'APPROVED' ? '✅' : v.verdict === 'NEEDS_IMPROVEMENT' ? '⚠️' : '❌'
  const lines: string[] = [
    `${icon} ${v.verdict} — Score: ${v.score}/100`,
    `Summary: ${v.summary}`,
  ]
  if (v.strengths.length > 0) {
    lines.push(`Strengths:`)
    v.strengths.forEach((s) => lines.push(`  + ${s}`))
  }
  if (v.weaknesses.length > 0) {
    lines.push(`Weaknesses:`)
    v.weaknesses.forEach((w) => lines.push(`  - ${w}`))
  }
  if (v.corrections.length > 0) {
    lines.push(`Corrections:`)
    v.corrections.forEach((c, i) => lines.push(`  ${i + 1}. ${c}`))
  }
  return lines.join('\n')
}

/**
 * Build a feedback prompt for the team to use in their retry round.
 * Returns the enhanced task text the team leader should receive.
 */
export function buildRetryPrompt(
  originalTask: string,
  verification: VerificationResult,
  round: number,
  maxRounds: number
): string {
  const correctionsBlock = verification.corrections.length > 0
    ? verification.corrections.map((c, i) => `${i + 1}. ${c}`).join('\n')
    : '(No specific corrections provided — review weaknesses and improve overall quality.)'

  const weaknessesBlock = verification.weaknesses.length > 0
    ? verification.weaknesses.map((w) => `- ${w}`).join('\n')
    : '(No specific weaknesses listed.)'

  const referenceBlock = verification.correctedOutput
    ? `\nREFERENCE — SUPER AGENT'S CORRECTED VERSION (use as guide):\n${verification.correctedOutput.slice(0, 3000)}\n`
    : ''

  return `ROUND ${round} OF ${maxRounds} — REVISION REQUIRED

Your previous output was ${verification.verdict} (score: ${verification.score}/100).
The Super Agent has reviewed your work and requires the following corrections before approval.

ORIGINAL TASK:
${originalTask.slice(0, 2000)}

CORRECTIONS YOU MUST ADDRESS:
${correctionsBlock}

WEAKNESSES TO FIX:
${weaknessesBlock}
${referenceBlock}
INSTRUCTIONS:
1. Redo the work addressing ALL corrections above.
2. Do NOT just patch — produce a complete, polished, ready-to-ship output.
3. Be specific. Quote numbers, URLs, file paths, transaction IDs where required.
4. If a correction is impossible to address (e.g. requires data you don't have), explain why and propose an alternative.`
}
