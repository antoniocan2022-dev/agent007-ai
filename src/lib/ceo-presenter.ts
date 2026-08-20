/**
 * CEO Final Presenter.
 *
 * A successful mission is publishable only when the required artifacts exist,
 * are marked verified, and the independent Verification Officer passes.
 */
import { callLlmWithRetry } from './agent'
import { db } from './db'
import { executeVerificationOfficerChallenge, type VerificationOfficerResult } from './verification-officer'
import { enforceCompletedArtifacts } from './artifact-contract'

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
  /** Present for reports produced by the current verification-aware presenter. */
  verificationDecision?: 'PASS' | 'CHALLENGE' | 'FAIL'
  verificationProofHash?: string | null
  /** Present for reports produced by the current artifact-aware presenter. */
  artifactGatePassed?: boolean
  artifactGateFailures?: string[]
}

const CEO_SYSTEM_PROMPT = `You are the CEO of Agent007.

You may report only what the mission actually delivered. Do not convert hypotheses,
LLM-generated prose, or unverified claims into facts. Concrete artifacts require
real IDs/URLs. A mission is successful only when BOTH the artifact-completion gate
AND the independent verification gate pass.

Never claim an action was executed, persisted, delivered, or verified unless the
input contains the corresponding proof.`

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
      findings: [{ code: 'MISSING_REQUIRED_CLAIM', message: 'No evidence ledger exists for this mission; independent verification cannot pass.' }],
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
  const artifactGate = enforceCompletedArtifacts(stages)

  const stagesBlock = stages.map((stage) =>
    `Stage ${stage.stage} (${stage.team}/${stage.leader}):\n` +
    `  - Artifact: ${stage.artifactValue ?? '(none)'}\n` +
    `  - Verified: ${stage.artifactVerified ? 'YES' : 'NO'}\n` +
    `  - Final score: ${stage.finalScore}/100 (after ${stage.rounds} round(s))\n` +
    `  - Approved at: ${stage.approvedAt ?? '(not approved)'}`,
  ).join('\n\n')

  const gateBlock = `ARTIFACT COMPLETION GATE:\n- Passed: ${artifactGate.valid}\n- Failures: ${artifactGate.failures.join(' | ') || 'None'}\n\nVERIFICATION OFFICER:\n- Decision: ${verification.decision}\n- Proof: ${verification.proofHash}\n- Findings: ${verification.findings.map((finding) => finding.message).join(' | ') || 'None'}`
  const userPrompt = `MISSION TITLE: ${missionTitle}\nMISSION OBJECTIVE: ${objective}\n\nSTAGES:\n${stagesBlock}\n\n${gateBlock}\n\nGenerate the executive report.`

  let fullReport: string
  try {
    const response = await callLlmWithRetry([
      { role: 'system', content: CEO_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ], { thinking: false })
    fullReport = typeof response === 'string' ? response : (response?.content ?? response?.message?.content ?? '')
  } catch {
    fullReport = `🎯 MISSION: ${missionTitle}\n📊 OUTCOME: partial (CEO LLM unavailable)\n✅ ARTIFACT GATE: ${artifactGate.valid ? 'PASS' : 'BLOCKED'}\n✅ VERIFICATION OFFICER: ${verification.decision}\n⚠️ RISKS/NOTES:\n   - ${[...artifactGate.failures, ...verification.findings.map((finding) => finding.message)].join('\n   - ') || 'None'}\n📈 NEXT STEPS:\n   1. Review evidence and artifacts.\n   2. Resolve blocked gates.\n   3. Re-run the mission.`
  }

  const allApproved = stages.length > 0 && stages.every((stage) => stage.artifactVerified && stage.finalScore >= 70)
  const someApproved = stages.some((stage) => stage.artifactVerified)
  const outcome: CeoReport['outcome'] = allApproved && artifactGate.valid && verification.decision === 'PASS'
    ? 'success'
    : someApproved
      ? 'partial'
      : 'failed'

  const keyDeliverables = stages
    .filter((stage) => stage.artifactValue)
    .map((stage) => `Stage ${stage.stage} (${stage.team}): ${stage.artifactValue}`)

  const risksNotes = [
    ...(artifactGate.valid ? [] : [`Artifact completion gate blocked success: ${artifactGate.failures.join(' | ')}`]),
    ...(verification.decision === 'PASS' ? [] : [`Verification Officer gate: ${verification.decision}. ${verification.findings.map((finding) => finding.message).join(' | ')}`]),
    ...(outcome === 'success' ? [] : ['A successful outcome is blocked until every required gate passes.']),
  ]

  return {
    missionId,
    missionTitle,
    objective,
    outcome,
    revenueImpact: 'See verified deliverables above',
    keyDeliverables,
    risksNotes,
    nextSteps: outcome === 'success'
      ? ['Review the verified CEO report', 'Approve any protected follow-up actions', 'Schedule the next mission']
      : ['Review the blocked gates', 'Resolve outstanding evidence/artifact issues', 'Re-run the mission when ready'],
    fullReport,
    generatedAt: new Date().toISOString(),
    verificationDecision: verification.decision,
    verificationProofHash: verification.proofHash === 'NO_EVIDENCE_LEDGER' ? null : verification.proofHash,
    artifactGatePassed: artifactGate.valid,
    artifactGateFailures: artifactGate.failures,
  }
}

export async function ceoPersistReport(report: CeoReport): Promise<void> {
  try {
    if (report.outcome === 'success' && (report.verificationDecision !== 'PASS' || report.artifactGatePassed !== true)) {
      console.warn('[ceo-presenter] Refusing to persist unproven success report.')
      return
    }
    const user = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
    if (!user) return
    const key = `ceo_report_${report.missionId}`
    const value = JSON.stringify(report)
    const existing = await db.userSetting.findFirst({ where: { userId: user.id, key } })
    if (existing) await db.userSetting.update({ where: { id: existing.id }, data: { value } })
    else await db.userSetting.create({ data: { userId: user.id, key, value } })
  } catch (error) {
    console.warn('[ceo-presenter] Failed to persist report:', error instanceof Error ? error.message.slice(0, 100) : String(error))
  }
}

export async function ceoSendTelegram(report: CeoReport): Promise<void> {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return
  if (report.outcome === 'success' && (report.verificationDecision !== 'PASS' || report.artifactGatePassed !== true)) return
  try {
    const text = `🎯 MISSION REPORT — ${report.outcome.toUpperCase()}\n\n${report.fullReport}\n\nArtifact Gate: ${report.artifactGatePassed === true ? 'PASS' : 'BLOCKED'}\nVerification Officer: ${report.verificationDecision ?? 'UNVERIFIED'}\n— Agent007 CEO`
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15000),
    })
  } catch (error) {
    console.warn('[ceo-presenter] Telegram failed:', error instanceof Error ? error.message.slice(0, 100) : String(error))
  }
}

export async function ceoSendEmail(report: CeoReport): Promise<void> {
  if (!process.env.OWNER_EMAIL) return
  if (report.outcome === 'success' && (report.verificationDecision !== 'PASS' || report.artifactGatePassed !== true)) return
  try {
    const { sendEmail } = await import('./email')
    await sendEmail({
      to: process.env.OWNER_EMAIL,
      subject: `Mission ${report.outcome}: ${report.missionTitle}`,
      body: `${report.fullReport}\n\nArtifact Gate: ${report.artifactGatePassed === true ? 'PASS' : 'BLOCKED'}\nVerification Officer: ${report.verificationDecision ?? 'UNVERIFIED'}`,
    })
  } catch (error) {
    console.warn('[ceo-presenter] Email failed:', error instanceof Error ? error.message.slice(0, 100) : String(error))
  }
}

export async function ceoPresentToOwner(opts: { missionId: string; missionTitle: string; objective: string; stages: MissionStageSummary[] }): Promise<CeoReport> {
  const report = await ceoGenerateReport(opts)
  await Promise.allSettled([ceoPersistReport(report), ceoSendTelegram(report), ceoSendEmail(report)])
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
