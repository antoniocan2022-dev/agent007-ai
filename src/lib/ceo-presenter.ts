/**
 * CEO Final Presenter.
 *
 * The CEO may summarize completed work, but a successful outcome is only
 * publishable when the independent Verification Officer passes the mission's
 * latest evidence ledger. A polished LLM response is never sufficient proof.
 */

import { callLlmWithRetry } from './agent'
import { db } from './db'
import { executeVerificationOfficerChallenge, type VerificationOfficerResult } from './verification-officer'

export interface MissionStageSummary {
  stage: number
  team: string
  leader: string
  artifactValue: string | null
  artifactVerified: boolean
  finalScore: number
  rounds: number
  approvedAt: string | null
}

export interface CeoReport {
  missionId: string
  missionTitle: string
  objective: string
  outcome: 'success' | 'partial' | 'failed'
  revenueImpact: string
  keyDeliverables: string[]
  risksNotes: string[]
  nextSteps: string[]
  fullReport: string
  generatedAt: string
  verificationDecision: 'PASS' | 'CHALLENGE' | 'FAIL'
  verificationProofHash: string | null
}

const CEO_SYSTEM_PROMPT = `You are the CEO of Agent007.

You may report only what the mission actually delivered. Do not convert hypotheses,
LLM-generated prose, or unverified claims into facts. Concrete artifacts require
real IDs/URLs. A mission is successful only when its independent verification gate
passes.

FORMAT:
🎯 MISSION: [one-line description]
📊 OUTCOME: [success/partial/failed]
💰 REVENUE IMPACT: [if applicable, otherwise N/A]
✅ KEY DELIVERABLES:
   - [real IDs/URLs/artifacts only]
⚠️ RISKS/NOTES:
   - [verification status and material risks]
📈 NEXT STEPS:
   1. [action]
   2. [action]
   3. [action]

Never claim an action was executed, persisted, delivered, or verified unless the
input contains an execution/evidence/verification proof for it.`

async function verifyMissionEvidence(missionId: string, missionTitle: string): Promise<VerificationOfficerResult> {
  const ledger = await db.evidenceLedger.findFirst({
    where: { missionId },
    orderBy: { version: 'desc' },
    include: { Source: true, Claim: true },
  })

  if (!ledger) {
    return {
      decision: 'CHALLENGE',
      officerId: 'verification_officer',
      version: 1,
      missionId,
      subject: missionTitle,
      findings: [{
        code: 'MISSING_REQUIRED_CLAIM',
        message: 'No evidence ledger exists for this mission; independent verification cannot pass.',
      }],
      challengedClaimKeys: [],
      proofHash: 'NO_EVIDENCE_LEDGER',
    }
  }

  const sources = ledger.Source.map((source) => ({
    sourceId: source.id,
    provider: source.provider,
    sourceUrl: source.sourceUrl,
    retrievedAt: source.retrievedAt.toISOString(),
  }))
  const claims = ledger.Claim.map((claim) => ({
    claimKey: claim.claimKey,
    value: claim.claimText,
    claimType: claim.classification === 'FACT' ? 'FACT' as const : claim.classification === 'HYPOTHESIS' ? 'HYPOTHESIS' as const : 'INFERENCE' as const,
    confidence: claim.confidence,
    sourceIds: claim.sourceId ? [claim.sourceId] : [],
    critical: claim.classification === 'FACT',
  }))

  return (await executeVerificationOfficerChallenge({
    missionId,
    subject: missionTitle,
    producerId: 'ceo-pipeline',
    sources,
    claims,
    requiredClaimKeys: claims.map((claim) => claim.claimKey),
  })).result
}

export async function ceoGenerateReport(opts: {
  missionId: string
  missionTitle: string
  objective: string
  stages: MissionStageSummary[]
}): Promise<CeoReport> {
  const { missionId, missionTitle, objective, stages } = opts
  const verification = await verifyMissionEvidence(missionId, missionTitle)

  const stagesBlock = stages.map((stage) =>
    `Stage ${stage.stage} (${stage.team}/${stage.leader}):\n` +
    `  - Artifact: ${stage.artifactValue ?? '(none)'}\n` +
    `  - Verified: ${stage.artifactVerified ? 'YES' : 'NO'}\n` +
    `  - Final score: ${stage.finalScore}/100 (after ${stage.rounds} round(s))\n` +
    `  - Approved at: ${stage.approvedAt ?? '(not approved)'}`,
  ).join('\n\n')

  const verificationBlock = `VERIFICATION OFFICER:\n- Decision: ${verification.decision}\n- Proof: ${verification.proofHash}\n- Findings: ${verification.findings.map((finding) => finding.message).join(' | ') || 'None'}`
  const userPrompt = `MISSION TITLE: ${missionTitle}\nMISSION OBJECTIVE: ${objective}\n\nSTAGES:\n${stagesBlock}\n\n${verificationBlock}\n\nGenerate the executive report. Follow the format exactly.`

  let fullReport: string
  try {
    const response = await callLlmWithRetry([
      { role: 'system', content: CEO_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ], { thinking: false })
    fullReport = typeof response === 'string' ? response : (response?.content ?? response?.message?.content ?? '')
  } catch {
    fullReport = `🎯 MISSION: ${missionTitle}\n📊 OUTCOME: partial (CEO LLM unavailable)\n💰 REVENUE IMPACT: N/A\n✅ KEY DELIVERABLES:\n${stages.map((stage) => `   - Stage ${stage.stage}: ${stage.artifactValue ?? '(none)'}`).join('\n')}\n⚠️ RISKS/NOTES:\n   - Independent Verification Officer: ${verification.decision}.\n   - CEO LLM unavailable; no success claim is authorized.\n📈 NEXT STEPS:\n   1. Review evidence.\n   2. Resolve verification findings.\n   3. Re-run the mission gate.`
  }

  const allApproved = stages.length > 0 && stages.every((stage) => stage.artifactVerified && stage.finalScore >= 70)
  const someApproved = stages.some((stage) => stage.artifactVerified)
  const outcome: CeoReport['outcome'] = allApproved && verification.decision === 'PASS'
    ? 'success'
    : someApproved
      ? 'partial'
      : 'failed'

  const keyDeliverables = stages
    .filter((stage) => stage.artifactValue)
    .map((stage) => `Stage ${stage.stage} (${stage.team}): ${stage.artifactValue}`)

  const risksNotes = [
    ...(verification.decision === 'PASS' ? [] : [`Verification Officer gate: ${verification.decision}. ${verification.findings.map((finding) => finding.message).join(' | ')}`]),
    ...(outcome === 'success' ? [] : ['A successful outcome is blocked until every required governance gate passes.']),
  ]

  return {
    missionId,
    missionTitle,
    objective,
    outcome,
    revenueImpact: 'See verified deliverables above',
    keyDeliverables,
    risksNotes,
    nextSteps: ['Review the verification result', 'Resolve outstanding evidence/governance findings', 'Re-run the mission when ready'],
    fullReport,
    generatedAt: new Date().toISOString(),
    verificationDecision: verification.decision,
    verificationProofHash: verification.proofHash === 'NO_EVIDENCE_LEDGER' ? null : verification.proofHash,
  }
}

export async function ceoPersistReport(report: CeoReport): Promise<void> {
  try {
    const user = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
    if (!user) return
    const key = `ceo_report_${report.missionId}`
    const value = JSON.stringify(report)
    const existing = await db.userSetting.findFirst({ where: { userId: user.id, key } })
    if (existing) {
      await db.userSetting.update({ where: { id: existing.id }, data: { value } })
    } else {
      await db.userSetting.create({ data: { userId: user.id, key, value } })
    }
  } catch (error) {
    console.warn('[ceo-presenter] Failed to persist report:', error instanceof Error ? error.message.slice(0, 100) : String(error))
  }
}

export async function ceoSendTelegram(report: CeoReport): Promise<void> {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return
  try {
    const text = `🎯 MISSION REPORT — ${report.outcome.toUpperCase()}\n\n${report.fullReport}\n\nVerification Officer: ${report.verificationDecision}\n— Agent007 CEO`
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15000),
    })
  } catch (error) {
    console.warn('[ceo-presenter] Telegram failed:', error instanceof Error ? error.message.slice(0, 100) : String(error))
  }
}

export async function ceoSendEmail(report: CeoReport): Promise<void> {
  if (!process.env.OWNER_EMAIL) return
  try {
    const { sendEmail } = await import('./email')
    await sendEmail({
      to: process.env.OWNER_EMAIL,
      subject: `Mission ${report.outcome}: ${report.missionTitle}`,
      body: `${report.fullReport}\n\nVerification Officer: ${report.verificationDecision}`,
    })
  } catch (error) {
    console.warn('[ceo-presenter] Email failed:', error instanceof Error ? error.message.slice(0, 100) : String(error))
  }
}

export async function ceoPresentToOwner(opts: {
  missionId: string
  missionTitle: string
  objective: string
  stages: MissionStageSummary[]
}): Promise<CeoReport> {
  const report = await ceoGenerateReport(opts)
  await Promise.allSettled([
    ceoPersistReport(report),
    ceoSendTelegram(report),
    ceoSendEmail(report),
  ])
  return report
}

export async function ceoLoadReport(missionId: string): Promise<CeoReport | null> {
  try {
    const user = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
    if (!user) return null
    const row = await db.userSetting.findFirst({ where: { userId: user.id, key: `ceo_report_${missionId}` } })
    if (!row) return null
    return JSON.parse(row.value) as CeoReport
  } catch {
    return null
  }
}
