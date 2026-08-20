import type { MissionStageSummary } from './ceo-presenter'

export type ArtifactExpectation = 'url' | 'transaction_id' | 'message_id' | 'file_path' | 'data' | 'none'

export type ArtifactValidation = {
  valid: boolean
  reason: string
}

const URL_RE = /^https?:\/\/[^\s]+$/i
const TX_RE = /\b(?:ch|pi|txn|sub|in)_[A-Za-z0-9]{10,}\b/
const MESSAGE_RE = /\bmsg[_-]?(?:\d{6,})\b|\b\d{10,}\b/i
const FILE_RE = /(?:^|\s)(?:\.?\.?\/|\/)[\w./-]+\.[A-Za-z0-9]+|\b[\w-]+\.(?:js|ts|tsx|jsx|py|md|json|html|css|pdf|csv)\b/i

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

/**
 * Final mission gate: every non-CEO stage must contain a verified artifact.
 * We intentionally do not infer the exact pipeline type here; this gate checks
 * the durable stage result and prevents a polished report from converting a
 * missing deliverable into mission success.
 */
export function enforceCompletedArtifacts(stages: MissionStageSummary[]): { valid: boolean; failures: string[] } {
  const failures: string[] = []
  for (const stage of stages) {
    if (stage.team === 'ceo') continue
    if (!stage.artifactVerified) failures.push(`Stage ${stage.stage} (${stage.team}) artifact is not verified.`)
    if (!stage.artifactValue?.trim()) failures.push(`Stage ${stage.stage} (${stage.team}) artifact is missing.`)
  }
  return { valid: failures.length === 0, failures }
}
