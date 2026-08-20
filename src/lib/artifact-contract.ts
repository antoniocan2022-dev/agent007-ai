import type { MissionStageSummary } from './ceo-presenter'

export type ArtifactExpectation = 'url' | 'transaction_id' | 'message_id' | 'file_path' | 'data' | 'none'

export type ArtifactValidation = {
  valid: boolean
  reason: string
}

export type VerifiedArtifact = {
  stage: number
  type: ArtifactExpectation
  value: string
  verified: boolean
  status?: number
  contentType?: string | null
  checkedAt: string
  reason: string
}

const URL_RE = /^https?:\/\/[^\s]+$/i
const TX_RE = /\b(?:ch|pi|txn|sub|in)_[A-Za-z0-9]{10,}\b/
const MESSAGE_RE = /\bmsg[_-]?(?:\d{6,})\b|\b\d{10,}\b/i
const FILE_RE = /(?:^|\s)(?:\.?\.?\/|\/)[\w./-]+\.[A-Za-z0-9]+|\b[\w-]+\.(?:js|ts|tsx|jsx|py|md|json|html|css|pdf|csv)\b/i

export function inferArtifactType(value: string | null | undefined, explicit?: ArtifactExpectation): ArtifactExpectation {
  if (explicit) return explicit
  const artifact = value?.trim() ?? ''
  if (URL_RE.test(artifact)) return 'url'
  if (TX_RE.test(artifact)) return 'transaction_id'
  if (MESSAGE_RE.test(artifact)) return 'message_id'
  if (FILE_RE.test(artifact)) return 'file_path'
  return 'data'
}

export function validateArtifactValue(type: ArtifactExpectation, value: string | null | undefined): ArtifactValidation {
  if (type === 'none') return { valid: true, reason: 'No artifact is required for this stage.' }
  const artifact = value?.trim()
  if (!artifact) return { valid: false, reason: `Required ${type} artifact is missing.` }

  if (type === 'url' && !URL_RE.test(artifact)) return { valid: false, reason: 'Artifact is not a valid HTTP(S) URL.' }
  if (type === 'transaction_id' && !TX_RE.test(artifact)) return { valid: false, reason: 'Artifact does not contain a recognized transaction identifier.' }
  if (type === 'message_id' && !MESSAGE_RE.test(artifact)) return { valid: false, reason: 'Artifact does not contain a recognized message identifier.' }
  if (type === 'file_path' && !FILE_RE.test(artifact)) return { valid: false, reason: 'Artifact does not contain a recognizable file reference.' }
  if (type === 'data' && artifact.length < 20) return { valid: false, reason: 'Data artifact is too small to constitute a meaningful deliverable.' }

  return { valid: true, reason: 'Artifact reference is structurally valid.' }
}

export async function verifyArtifactEvidence(stages: MissionStageSummary[]): Promise<VerifiedArtifact[]> {
  const results: VerifiedArtifact[] = []
  for (const stage of stages) {
    if (stage.team === 'ceo' || stage.artifactType === 'none') continue
    const type = inferArtifactType(stage.artifactValue, stage.artifactType)
    const value = stage.artifactValue?.trim() ?? ''
    const structural = validateArtifactValue(type, value)
    if (!structural.valid) {
      results.push({ stage: stage.stage, type, value, verified: false, checkedAt: new Date().toISOString(), reason: structural.reason })
      continue
    }

    if (type === 'url') {
      try {
        const response = await fetch(value, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(10000) })
        results.push({
          stage: stage.stage,
          type,
          value,
          verified: response.status >= 200 && response.status < 400,
          status: response.status,
          contentType: response.headers.get('content-type'),
          checkedAt: new Date().toISOString(),
          reason: response.status >= 200 && response.status < 400 ? 'URL reached successfully.' : `URL returned HTTP ${response.status}.`,
        })
      } catch (error) {
        results.push({ stage: stage.stage, type, value, verified: false, checkedAt: new Date().toISOString(), reason: `URL verification failed: ${error instanceof Error ? error.message : String(error)}` })
      }
      continue
    }

    results.push({
      stage: stage.stage,
      type,
      value,
      verified: stage.artifactVerified,
      checkedAt: new Date().toISOString(),
      reason: stage.artifactVerified ? 'Upstream governed execution marked the artifact verified.' : 'Artifact lacks an upstream verification proof.',
    })
  }
  return results
}

export function enforceCompletedArtifacts(stages: MissionStageSummary[]): { valid: boolean; failures: string[] } {
  const failures: string[] = []
  for (const stage of stages) {
    if (stage.team === 'ceo') continue
    if (!stage.artifactValue?.trim()) failures.push(`Stage ${stage.stage} (${stage.team}) artifact is missing.`)
    if (stage.artifactType === 'none') continue
    if (!stage.artifactVerified) failures.push(`Stage ${stage.stage} (${stage.team}) artifact is not verified.`)
  }
  return { valid: failures.length === 0, failures }
}

export function enforceVerifiedArtifactEvidence(stages: MissionStageSummary[], verifiedArtifacts: VerifiedArtifact[]): { valid: boolean; failures: string[] } {
  const failures = [...enforceCompletedArtifacts(stages).failures]
  const byStage = new Map(verifiedArtifacts.map((artifact) => [artifact.stage, artifact]))
  for (const stage of stages) {
    if (stage.team === 'ceo' || stage.artifactType === 'none') continue
    const evidence = byStage.get(stage.stage)
    if (!evidence?.verified) failures.push(`Stage ${stage.stage} (${stage.team}) lacks evidentiary artifact verification.`)
  }
  return { valid: failures.length === 0, failures }
}
