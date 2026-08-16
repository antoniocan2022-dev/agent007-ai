import { access, stat } from 'node:fs/promises'
import { getArtifact, verifyArtifact, type ArtifactKind, type ArtifactRecord } from './architecture-control-plane'

export interface ArtifactVerificationResult {
  verified: boolean
  artifact: ArtifactRecord | null
  reason: string
  source: string
}

async function verifyValue(kind: ArtifactKind, value: string): Promise<{ ok: boolean; reason: string }> {
  const trimmed = value.trim()
  if (!trimmed) return { ok: false, reason: 'Artifact value is empty.' }

  if (kind === 'url') {
    try {
      const url = new URL(trimmed)
      if (!['http:', 'https:'].includes(url.protocol)) return { ok: false, reason: 'Only HTTP(S) URLs are verifiable.' }
      const response = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(10000) })
      if (response.ok) return { ok: true, reason: `HTTP ${response.status}` }
      // Some hosts reject HEAD but permit GET. A bounded GET is still evidence that the URL resolves.
      const fallback = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(10000) })
      return fallback.ok ? { ok: true, reason: `HTTP ${fallback.status}` } : { ok: false, reason: `URL returned HTTP ${fallback.status}.` }
    } catch (error) {
      return { ok: false, reason: `URL verification failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  if (kind === 'file_path') {
    try {
      await access(trimmed)
      const metadata = await stat(trimmed)
      return metadata.isFile() || metadata.isDirectory()
        ? { ok: true, reason: 'Filesystem object exists.' }
        : { ok: false, reason: 'Filesystem object is not a file or directory.' }
    } catch {
      return { ok: false, reason: 'Referenced file path does not exist in the executing environment.' }
    }
  }

  if (kind === 'data') {
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed === null || (typeof parsed !== 'object' && !Array.isArray(parsed))) return { ok: false, reason: 'Data artifact must contain a JSON object or array.' }
      return { ok: true, reason: 'Data artifact passed structural JSON validation.' }
    } catch {
      return { ok: false, reason: 'Data artifact is not valid JSON; an explicit domain verifier is required.' }
    }
  }

  // Payment/message identifiers are external claims. Length checks are not proof.
  // They remain PRODUCED until the relevant provider/communication adapter verifies them.
  if (kind === 'transaction_id') return { ok: false, reason: 'Transaction IDs require provider-specific verification; shape alone is not evidence.' }
  if (kind === 'message_id') return { ok: false, reason: 'Message IDs require provider-specific verification; shape alone is not evidence.' }
  if (kind === 'none') return { ok: true, reason: 'No artifact verification is required.' }

  return { ok: false, reason: `No verifier is registered for artifact type ${kind}.` }
}

export async function verifyCanonicalArtifact(artifactId: string, actor: string, expected: { ventureId?: string | null; missionId?: string | null; stage?: string }): Promise<ArtifactVerificationResult> {
  const artifact = await getArtifact(artifactId)
  if (!artifact) return { verified: false, artifact: null, reason: 'Artifact not found in Canonical Artifact Ledger.', source: 'artifact-verifier' }
  if (expected.ventureId !== undefined && artifact.ventureId !== expected.ventureId) return { verified: false, artifact, reason: 'Artifact venture ownership mismatch.', source: 'artifact-verifier' }
  if (expected.missionId !== undefined && artifact.missionId !== expected.missionId) return { verified: false, artifact, reason: 'Artifact mission ownership mismatch.', source: 'artifact-verifier' }
  if (expected.stage !== undefined && artifact.stage !== expected.stage) return { verified: false, artifact, reason: 'Artifact stage mismatch.', source: 'artifact-verifier' }
  if (artifact.status === 'VERIFIED') return { verified: true, artifact, reason: 'Artifact is already verified.', source: artifact.verificationSource ?? 'artifact-ledger' }
  const result = await verifyValue(artifact.artifactType, artifact.value)
  if (!result.ok) return { verified: false, artifact, reason: result.reason, source: 'artifact-verifier' }
  const verified = await verifyArtifact(artifactId, actor, `artifact-verifier:${result.reason}`)
  return { verified: true, artifact: verified, reason: result.reason, source: verified.verificationSource ?? 'artifact-verifier' }
}
