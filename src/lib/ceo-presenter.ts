import { runCeoCognitiveLifecycle } from './ceo-cognitive-lifecycle'
import { db } from './db'
import { executeVerificationOfficerChallenge, type VerificationOfficerResult } from './verification-officer'
import { enforceVerifiedArtifactEvidence, verifyArtifactEvidence } from './artifact-contract'
import { evaluateCeoDecision, type CeoDecisionKernelResult } from './ceo-decision-kernel'

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
  evidenceState?: string
  cognitivePath?: string
  reasoningStrategy?: string
  artifactEvidence?: Awaited<ReturnType<typeof verifyArtifactEvidence>>
}

const CEO_SYSTEM_PROMPT = `You are the CEO of Agent007.\n\nYou may report only what the mission actually delivered. Do not convert hypotheses,\nLLM-generated prose, or unverified claims into facts. Concrete artifacts require\nreal IDs/URLs. A mission is successful only when BOTH the artifact-completion gate\nAND the independent verification gate pass.\n\nNever claim an action was executed, persisted, delivered, or verified unless the\ninput contains the corresponding proof.\n\nThe Mission Governance Gate is authoritative. You may explain its decision but you may not\noverride a BLOCK, HOLD, REJECT, missing evidence, missing artifacts, or an unresolved\nverification challenge.`

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

function buildGovernanceBlockedReport(input: {
  missionTitle: string
  artifactGatePassed: boolean
  artifactFailures: string[]
  verification: VerificationOfficerResult
  decisionKernel: CeoDecisionKernelResult
}): string {
  return `🎯 MISSION: ${input.missionTitle}\n🛡️ CEO GENERATION BOUNDARY: ${input.decisionKernel.decision}\n\nThe mission governance gate did not authorize a normal executive synthesis. Agent007 will not manufacture a success narrative while required gates remain unresolved.\n\nArtifact Gate: ${input.artifactGatePassed ? 'PASS' : 'BLOCKED'}\nVerification Officer: ${input.verification.decision}\nCEO Governance Decision: ${input.decisionKernel.decision}\nNext Action: ${input.decisionKernel.nextAction}\n\nBlocking reasons:\n- ${[
    ...input.artifactFailures,
    ...input.verification.findings.map((finding) => finding.message),
    ...input.decisionKernel.rationale,
  ].filter(Boolean).join('\n- ') || 'No blocking reason recorded.'}\n\nA normal LLM-generated executive synthesis will be allowed only after the governance decision becomes PROCEED.`
}

export async function ceoGenerateReport(opts: { missionId: string; missionTitle: string; objective: string; stages: MissionStageSummary[] }): Promise<CeoReport> {
  const { missionId, missionTitle, objective, stages } = opts
  const verification = await verifyMissionEvidence(missionId, missionTitle)
  const verifiedArtifacts = await verifyArtifactEvidence(stages)
  const artifactGate = enforceVerifiedArtifactEvidence(stages, verifiedArtifacts)
  const criticalConflictCount = verification.findings.filter((finding) => finding.code === 'CONFLICTING_CLAIMS').length
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

  const gateBlock = `ARTIFACT COMPLETION GATE:\n- Passed: ${artifactGate.valid}\n- Failures: ${artifactGate.failures.join(' | ') || 'None'}\n\nVERIFICATION OFFICER:\n- Decision: ${verification.decision}\n- Proof: ${verification.proofHash}\n- Findings: ${verification.findings.map((finding) => finding.message).join(' | ') || 'None'}\n\nCEO MISSION GOVERNANCE GATE:\n- Decision: ${decisionKernel.decision}\n- Confidence: ${decisionKernel.confidence}/100\n- Evidence gate: ${decisionKernel.gates.evidence}\n- Artifact gate: ${decisionKernel.gates.artifact}\n- Verification gate: ${decisionKernel.gates.verification}\n- Governance gate: ${decisionKernel.gates.governance}\n- Next action: ${decisionKernel.nextAction}\n- Rationale: ${decisionKernel.rationale.join(' | ')}`

  const generationAuthorized = decisionKernel.decision === 'PROCEED'
  let fullReport: string
  let provider: string | undefined
  let model: string | undefined
  let evidenceState: string | undefined
  let cognitivePath: string | undefined
  let reasoningStrategy: string | undefined

  if (!generationAuthorized) {
    fullReport = buildGovernanceBlockedReport({
      missionTitle,
      artifactGatePassed: artifactGate.valid,
      artifactFailures: artifactGate.failures,
      verification,
      decisionKernel,
    })
    evidenceState = verification.decision === 'PASS' ? 'VERIFIED_CACHED' : 'PARTIAL_UNCONFIRMED'
    cognitivePath = 'blocked'
    reasoningStrategy = 'governance_block'
  } else {
    const userPrompt = `MISSION TITLE: ${missionTitle}\nMISSION OBJECTIVE: ${objective}\n\nSTAGES:\n${stagesBlock}\n\n${gateBlock}\n\nGenerate the executive report. Do not claim success unless the Decision Gate says PROCEED.`
    try {
      const response = await runCeoCognitiveLifecycle({
        missionId,
        verification: verification.decision === 'PASS' ? 'enhanced' : 'strict',
        contextualEvidence: `${gateBlock}\n\n${stagesBlock}`,
        messages: [
          { role: 'system', content: CEO_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        timeoutMs: 90000,
      })
      fullReport = response.content
      provider = response.provider
      model = response.model
      evidenceState = response.evidenceState
      cognitivePath = response.decisionPlan.path
      reasoningStrategy = response.decisionPlan.reasoningStrategy
    } catch {
      fullReport = `🎯 MISSION: ${missionTitle}\n📊 OUTCOME: partial (CEO cognitive lifecycle unavailable)\n✅ ARTIFACT GATE: ${artifactGate.valid ? 'PASS' : 'BLOCKED'}\n✅ VERIFICATION OFFICER: ${verification.decision}\n🧠 CEO MISSION GOVERNANCE GATE: ${decisionKernel.decision} (${decisionKernel.confidence}/100)\n⚠️ RISKS/NOTES:\n   - ${[...artifactGate.failures, ...verification.findings.map((finding) => finding.message), ...decisionKernel.rationale].join('\n   - ') || 'None'}\n📈 NEXT STEPS:\n   1. Review evidence and artifacts.\n   2. Resolve blocked gates.\n   3. Re-run the mission.`
      evidenceState = 'UNAVAILABLE'
      cognitivePath = 'blocked'
      reasoningStrategy = 'execution_failure'
    }
  }

  const allApproved = stages.length > 0 && stages.every((stage) => stage.artifactVerified && stage.finalScore >= 70)
  const someApproved = stages.some((stage) => stage.artifactVerified)
  const outcome: CeoReport['outcome'] = allApproved && artifactGate.valid && verification.decision === 'PASS' && decisionKernel.decision === 'PROCEED'
    ? 'success'
    : someApproved ? 'partial' : 'failed'

  const keyDeliverables = stages.filter((stage) => stage.artifactValue).map((stage) => `Stage ${stage.stage} (${stage.team}): ${stage.artifactValue}`)
  const risksNotes = [
    ...(artifactGate.valid ? [] : [`Artifact completion gate blocked success: ${artifactGate.failures.join(' | ')}`]),
    ...(verification.decision === 'PASS' ? [] : [`Verification Officer gate: ${verification.decision}. ${verification.findings.map((finding) => finding.message).join(' | ')}`]),
    ...(decisionKernel.decision === 'PROCEED' ? [] : [`CEO Mission Governance Gate: ${decisionKernel.decision}. ${decisionKernel.rationale.join(' | ')}`]),
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
    nextSteps: outcome === 'success' ? ['Review the verified CEO report', 'Approve any protected follow-up actions', 'Schedule the next mission'] : ['Review the blocked gates', 'Resolve outstanding evidence/artifact issues', 'Re-run the mission when ready'],
    fullReport,
    generatedAt: new Date().toISOString(),
    verificationDecision: verification.decision,
    verificationProofHash: verification.proofHash === 'NO_EVIDENCE_LEDGER' ? null : verification.proofHash,
    artifactGatePassed: artifactGate.valid,
    artifactGateFailures: artifactGate.failures,
    decisionKernel,
    provider,
    model,
    evidenceState,
    cognitivePath,
    reasoningStrategy,
    artifactEvidence: verifiedArtifacts,
  }
}

export async function ceoPersistReport(report: CeoReport): Promise<void> {
  try {
    if (report.outcome === 'success' && (report.verificationDecision !== 'PASS' || report.artifactGatePassed !== true || report.decisionKernel?.decision !== 'PROCEED')) return
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
    const text = `🎯 MISSION REPORT — ${report.outcome.toUpperCase()}\n\n${report.fullReport}\n\nArtifact Gate: ${report.artifactGatePassed === true ? 'PASS' : 'BLOCKED'}\nVerification Officer: ${report.verificationDecision ?? 'UNVERIFIED'}\nCEO Mission Governance Gate: ${report.decisionKernel?.decision ?? 'UNAVAILABLE'}\nEvidence State: ${report.evidenceState ?? 'UNKNOWN'}\nProvider: ${report.provider ?? 'UNAVAILABLE'} / ${report.model ?? 'UNAVAILABLE'}\n— Agent007 CEO`
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }), signal: AbortSignal.timeout(15000) })
  } catch (error) { console.warn('[ceo-presenter] Telegram failed:', error instanceof Error ? error.message.slice(0, 100) : String(error)) }
}

export async function ceoSendEmail(report: CeoReport): Promise<void> {
  if (!process.env.OWNER_EMAIL) return
  if (report.outcome === 'success' && (report.verificationDecision !== 'PASS' || report.artifactGatePassed !== true || report.decisionKernel?.decision !== 'PROCEED')) return
  try {
    const { sendEmail } = await import('./email')
    await sendEmail({ to: process.env.OWNER_EMAIL, subject: `Mission ${report.outcome}: ${report.missionTitle}`, body: `${report.fullReport}\n\nArtifact Gate: ${report.artifactGatePassed === true ? 'PASS' : 'BLOCKED'}\nVerification Officer: ${report.verificationDecision ?? 'UNVERIFIED'}\nCEO Mission Governance Gate: ${report.decisionKernel?.decision ?? 'UNAVAILABLE'}\nEvidence State: ${report.evidenceState ?? 'UNKNOWN'}\nProvider: ${report.provider ?? 'UNAVAILABLE'} / ${report.model ?? 'UNAVAILABLE'}` })
  } catch (error) { console.warn('[ceo-presenter] Email failed:', error instanceof Error ? error.message.slice(0, 100) : String(error)) }
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
  } catch { return null }
}
