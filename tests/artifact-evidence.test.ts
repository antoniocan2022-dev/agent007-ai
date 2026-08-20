import { describe, expect, test } from 'bun:test'
import { enforceVerifiedArtifactEvidence, verifyArtifactEvidence } from '@/lib/artifact-contract'

describe('Artifact evidence verification', () => {
  test('rejects a URL that is syntactically valid but unreachable', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => { throw new Error('network unavailable') }) as typeof fetch
    try {
      const stages = [{ stage: 1, team: 'scout', leader: 'scout', artifactValue: 'https://example.com/result', artifactVerified: true, finalScore: 95, rounds: 1, approvedAt: new Date().toISOString(), artifactType: 'url' as const }]
      const evidence = await verifyArtifactEvidence(stages)
      expect(evidence[0]?.verified).toBe(false)
      expect(enforceVerifiedArtifactEvidence(stages, evidence).valid).toBe(false)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('accepts a reachable URL only after an actual HTTP success', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } })) as typeof fetch
    try {
      const stages = [{ stage: 1, team: 'scout', leader: 'scout', artifactValue: 'https://example.com/result', artifactVerified: true, finalScore: 95, rounds: 1, approvedAt: new Date().toISOString(), artifactType: 'url' as const }]
      const evidence = await verifyArtifactEvidence(stages)
      expect(evidence[0]?.verified).toBe(true)
      expect(enforceVerifiedArtifactEvidence(stages, evidence).valid).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
