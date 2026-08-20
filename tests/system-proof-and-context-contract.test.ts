import { describe, expect, test } from 'bun:test'
import { getSystemManifest } from '@/lib/system-manifest'
import { validateArtifactValue, enforceCompletedArtifacts } from '@/lib/artifact-contract'
import { resolveMissionContext } from '@/lib/mission-context-resolver'

describe('system proof and context contracts', () => {
  test('canonical manifest reports live tool and specialist counts without stale hard-coded totals', () => {
    const manifest = getSystemManifest()
    expect(manifest.manifestId).toBe('agent007-system')
    expect(manifest.capabilities.toolCount).toBeGreaterThan(0)
    expect(manifest.organization.specialistCount).toBeGreaterThan(0)
    expect(manifest.proof.executionReceipts).toBe(true)
    expect(manifest.proof.evidenceLedger).toBe(true)
    expect(manifest.proof.verificationOfficer).toBe(true)
  })

  test('artifact contract rejects missing or malformed required deliverables', () => {
    expect(validateArtifactValue('url', null).valid).toBe(false)
    expect(validateArtifactValue('url', 'not-a-url').valid).toBe(false)
    expect(validateArtifactValue('url', 'https://example.com/result').valid).toBe(true)
    expect(validateArtifactValue('transaction_id', 'hello').valid).toBe(false)
    expect(validateArtifactValue('data', 'too short').valid).toBe(false)
    expect(validateArtifactValue('data', 'This is a sufficiently meaningful data artifact.').valid).toBe(true)
  })

  test('final artifact gate blocks a mission with an unverified or missing deliverable', () => {
    const blocked = enforceCompletedArtifacts([
      { stage: 1, team: 'scout', leader: 'scout', artifactValue: null, artifactVerified: false, finalScore: 95, rounds: 1, approvedAt: null },
      { stage: 2, team: 'ceo', leader: 'ceo', artifactValue: null, artifactVerified: true, finalScore: 100, rounds: 1, approvedAt: new Date().toISOString() },
    ])
    expect(blocked.valid).toBe(false)
    expect(blocked.failures.length).toBeGreaterThan(0)

    const passed = enforceCompletedArtifacts([
      { stage: 1, team: 'scout', leader: 'scout', artifactValue: 'research report with verified data', artifactVerified: true, finalScore: 95, rounds: 1, approvedAt: new Date().toISOString() },
      { stage: 2, team: 'ceo', leader: 'ceo', artifactValue: null, artifactVerified: true, finalScore: 100, rounds: 1, approvedAt: new Date().toISOString() },
    ])
    expect(passed.valid).toBe(true)
  })

  test('mission-context resolver fails closed without an explicit durable mission id', async () => {
    await expect(resolveMissionContext('')).rejects.toThrow('MISSION_CONTEXT_MISSING')
  })
})
