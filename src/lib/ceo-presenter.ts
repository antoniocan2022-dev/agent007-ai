import { runCanonicalLlm } from './canonical-llm-router'
import { db } from './db'
import { executeVerificationOfficerChallenge, type VerificationOfficerResult } from './verification-officer'
import { enforceVerifiedArtifactEvidence, verifyArtifactEvidence } from './artifact-contract'
import { evaluateCeoDecision, type CeoDecisionKernelResult } from './ceo-decision-kernel'
import { recordModelOutcome } from './outcome-intelligence'
import type { ProviderId } from './subagent-governance'

export interface MissionStageSummary {
  stage: number
  team: string
  leader: string
  artifactValue: string | null
  artifactVerified: boolean
  finalScore: number
  rounds: number
  approvedAt: string | null
  artifactType?: 'url' | 'transaction_id' | 'message_id' | 'file_path' | 'data' | 'none'
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
  verificationDecision?: 'PASS' | 'CHALLENGE' | 'FAIL'
  verificationProofHash?: string | null
  artifactGatePassed?: boolean
  artifactGateFailures?: string[]
  decisionKernel?: CeoDecisionKernelResult
  provider?: string
  model?: string
  artifactEvidence?: Awaited<ReturnType<typeof verifyArtifactEvidence>>
}

const CEO_SYSTEM_PROMPT = `You are the CEO of Agent007.

You may report only what the mission actually delivered. Do not convert hypotheses,
LLM-generated prose, or unverified claims into facts. Concrete artifacts require
real IDs/URLs. A mission is successful only when BOTH the artifact-completion gate
AND the independent verification gate pass.

Never claim an action was executed, persisted, delivered, or verified unless the
input contains the corresponding proof.

The Decision Kernel is authoritative. You may explain its decision but you may not
override a BLOCK, HOLD, REJECT, missing evidence, missing artifacts, or an unresolved
verification challenge.`

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
  const verifiedArtifacts = await verifyArtifactEvidence(stages)
  const artifactGate = enforceVerifiedArtifactEvidence(stages, verifiedArtifacts)
  const criticalConflictCount = verification.findings.filter((finding) => finding.code === 'CONFLICTING_EVIDENCE').length
  const decisionKernel = evaluateCeoDecision({
    missionId,
    objective,
    artifactGatePassed: artifactGate.valid,
    verificationDecision: verification.decision,
    evidenceCount: verification.findings.some((finding) => finding.code === 'MISSING_REQUIRED_CLAIM') ? 0 : verification.findings.length === 0 ? 1 : 0,
    criticalConflictCount,
    protectedActionRequested: false,
    verificationTier: verification.decision === 'PASS' ? 'enhanced' : 'strict',
  })

  const stagesBlock = stages.map((stage) =>
    `Stage ${stage.stage} (${stage.team}/${stage.leader}):\n` +
    `  - Artifact: ${stage.artifactValue ?? '(none)'}\n` +
    `  - Type: ${stage.artifactType ?? 'unspecified'}\n` +
    `  - Verified: ${stage.artifactVerified ? 'YES' : 'NO'}\n` +
    `  - Evidence verification: ${verifiedArtifacts.find((artifact) => artifact.stage === stage.stage)?.reason ?? 'not checked'}\n` +
    `  - Final score: ${stage.finalScore}/100 (after ${stage.rounds} round(s))\n` +
    `  - Approved at: ${stage.approvedAt ?? '(not approved)'}`,
  ).join('\n\n')

  const gateBlock = `ARTIFACT COMPLETION GATE:\n- Passed: ${artifactGate.valid}\n- Failures: ${artifactGate.failures.join(' | ') || 'None'}\n\nVERIFICATION OFFICER:\n- Decision: ${verification.decision}\n- Proof: ${verification.proofHash}\n- Findings: ${verification.findings.map((finding) => finding.message).join(' | ') || 'None'}\n\nCEO DECISION KERNEL:\n- Decision: ${decisionKernel.decision}\n- Confidence: ${decisionKernel.confidence}/100\n- Evidence gate: ${decisionKernel.gates.evidence}\n- Artifact gate: ${decisionKernel.gates.artifact}\n- Verification gate: ${decisionKernel.gates.verification}\n- Governance gate: ${decisionKernel.gates.governance}\n- Next action: ${decisionKernel.nextAction}\n- Rationale: ${decisionKernel.rationale.join(' | ')}`

  const userPrompt = `MISSION TITLE: ${missionTitle}\nMISSION OBJECTIVE: ${objective}\n\nSTAGES:\n${stagesBlock}\n\n${gateBlock}\n\nGenerate the executive report. Do not claim success unless the Decision Kernel says PROCEED.`

  let fullReport: string
  let provider: ProviderId | undefined
  let model: string | undefined
  try {
    const response = await runCanonicalLlm({
      taskType: 'reasoning',
      verification: verification.decision === 'PASS' ? 'enhanced' : 'strict',
      messages: [
        { role: 'system', content: CEO_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      thinking: false,
    })
    fullReport = response.content
    provider = response.provider
    model = response.model
  } catch {
    fullReport = `🎯 MISSION: ${missionTitle}\n📊 OUTCOME: partial (CEO LLM unavailable)\n✅ ARTIFACT GATE: ${artifactGate.valid ? 'PASS' : 'BLOCKED'}\n✅ VERIFICATION OFFICER: ${verification.decision}\n🧠 DECISION KERNEL: ${decisionKernel.decision} (${decisionKernel.confidence}/100)\n⚠️ RISKS/NOTES:\n   - ${[...artifactGate.failures, ...verification.findings.map((finding) => finding.message), ...decisionKernel.rationale].join('\n   - ') || 'None'}\n📈 NEXT STEPS:\n   1. Review evidence and artifacts.\n   2. Resolve blocked gates.\n   3. Re-run the mission.`
  }

  const allApproved = stages.length > 0 && stages.every((stage) => stage.artifactVerified && stage.finalScore >= 70)
  const someApproved = stages.some((stage) => stage.artifactVerified)
  const outcome: CeoReport['outcome'] = allApproved && artifactGate.valid && verification.decision === 'PASS' && decisionKernel.decision === 'PROCEED'
    ? 'success'
    : someApproved
      ? 'partial'
      : 'failed'

  if (provider && model) {
    recordModelOutcome({
      provider,
      model,
      taskType: 'reasoning',
      status: outcome === 'success' && verification.decision === 'PASS' ? 'verified_success' : outcome === 'partial' ? 'partial' : 'failed',
      qualityScore: Math.round(stages.length ? stages.reduce((sum, stage) => sum + stage.finalScore, 0) / stages.length : 0),
      businessValueScore: outcome === 'success' ? 100 : outcome === 'partial' ? 60 : 0,
      verificationPassed: verification.decision === 'PASS' && decisionKernel.decision === 'PROCEED',
    })
  }

  const keyDeliverables = stages
    .filter((stage) => stage.artifactValue)
    .map((stage) => `Stage ${stage.stage} (${stage.team}): ${stage.artifactValue}`)

  const risksNotes = [
    ...(artifactGate.valid ? [] : [`Artifact completion gate blocked success: ${artifactGate.failures.join(' | ')}`]),
    ...(verification.decision === 'PASS' ? [] : [`Verification Officer gate: ${verification.decision}. ${verification.findings.map((finding) => finding.message).join(' | ')}`]),
    ...(decisionKernel.decision === 'PROCEED' ? [] : [`CEO Decision Kernel: ${decisionKernel.decision}. ${decisionKernel.rationale.join(' | ')}`]),
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
    decisionKernel,
    provider,
    model,
    artifactEvidence: verifiedArtifacts,
  }
}

export async function ceoPersistReport(report: CeoReport): Promise<void> {
  try {
    if (report.outcome === 'success' && (report.verificationDecision !== 'PASS' || report.artifactGatePassed !== true || report.decisionKernel?.decision !== 'PROCEED')) {
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
  if (report.outcome === 'success' && (report.verificationDecision !== 'PASS' || report.artifactGatePassed !== true || report.decisionKernel?.decision !== 'PROCEED')) return
  try {
    const text = `🎯 MISSION REPORT — ${report.outcome.toUpperCase()}\n\n${report.fullReport}\n\nArtifact Gate: ${report.artifactGatePassed === true ? 'PASS' : 'BLOCKED'}\nVerification Officer: ${report.verificationDecision ?? 'UNVERIFIED'}\nCEO Decision Kernel: ${report.decisionKernel?.decision ?? 'UNAVAILABLE'}\nProvider: ${report.provider ?? 'UNAVAILABLE'} / ${report.model ?? 'UNAVAILABLE'}\n— Agent007 CEO`
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
  if (report.outcome === 'success' && (report.verificationDecision !== 'PASS' || report.artifactGatePassed !== true || report.decisionKernel?.decision !== 'PROCEED')) return
  try {
    const { sendEmail } = await import('./email')
    await sendEmail({
      to: process.env.OWNER_EMAIL,
      subject: `Mission ${report.outcome}: ${report.missionTitle}`,
      body: `${report.fullReport}\n\nArtifact Gate: ${report.artifactGatePassed === true ? 'PASS' : 'BLOCKED'}\nVerification Officer: ${report.verificationDecision ?? 'UNVERIFIED'}\nCEO Decision Kernel: ${report.decisionKernel?.decision ?? 'UNAVAILABLE'}\nProvider: ${report.provider ?? 'UNAVAILABLE'} / ${report.model ?? 'UNAVAILABLE'}`,
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
